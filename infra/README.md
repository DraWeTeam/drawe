# infra — 배포 인프라

Drawe 서비스의 AWS 인프라를 Terraform 으로 관리합니다. 모노레포 `infra/` 디렉터리에 위치합니다.

> 현재 인프라 구조를 지속적으로 개선 중이며, 구성과 비용 전략은 프로젝트 진행에 따라 변경될 수 있습니다.

dev / prod 환경을 별도 AWS 계정으로 운영하며, **EKS (Graviton ARM64)** 기반으로 애플리케이션(backend · fastapi·embed · fastapi·guide)과 observability 스택을 구성합니다.

> **ECS → EKS 전환** — 초기엔 ECS(EC2 ASG + 서비스 오토스케일)로 운영했습니다. 노드 스케일 반응성(스케줄러 직결), 워크로드 맞춤 인스턴스 동적 선택(spot, 비용), GitOps 무중단 배포, dev/prod 운영모델 통일을 위해 **EKS + Karpenter + ArgoCD** 로 고도화했습니다. (오토스케일 자체는 ECS 때도 있었고, EKS 전환은 *방식 고도화*입니다.)

## 핵심 설계

* dev / prod 별도 AWS 계정 운영
* **EKS (K8s 1.35) + Graviton ARM64** 기반
* **Karpenter(노드) + HPA(파드) 2계층 오토스케일** — NodePool 은 on-demand + spot 혼용, 인스턴스 패밀리 다종(m6g/m7g/c6g/c7g/r6g)으로 분산(비용·가용성)
* **ArgoCD GitOps** — `main` auto-sync(prune+selfHeal), 롤링 무중단(PDB + readiness)
* Terraform 기반 IaC 관리 (state 는 S3 원격 백엔드)
* **IRSA** 로 파드 단위 최소권한(AWS 자격증명 비저장)
* Alloy 기반 OpenTelemetry 수집 (DaemonSet 구조)
* Cloudflare + **ALB Ingress(group=drawe-prod, 단일 ALB 공유)** 기반 HTTPS (가이드 서비스는 ClusterIP 내부 전용, ALB 미경유)
* dev 환경은 스케줄 기반 자동 on/off 로 비용 절감 / prod 는 토글 + 노드 스케일로 비활성 시간 절감

## 디렉토리 구조

```text
infra/
├── terraform-dev/                    # dev 환경 Terraform (애플리케이션·네트워크)
├── terraform-prod/                   # prod 환경 Terraform
│   └── eks · karpenter · alb-ingress · irsa · cloudflare · rds …
├── eks/                              # EKS 플랫폼 레이어 (platform: Karpenter NodePool · ArgoCD · ESO · observability IRSA)
├── k8s/                              # 쿠버네티스 매니페스트 (kustomize base/ + overlays/dev·prod) — ArgoCD 가 동기화
├── configs/                          # Alloy / Grafana / Loki / Tempo config
├── scripts/                          # 운영 보조 스크립트 (seed-local.sh, upload-alloy-config.sh)
├── runbooks/                         # 운영 절차 — phase3_dev_store_backfill.md (가이드 스토어 백필)
├── local-init/                       # 로컬 artref(가이드 소스) DB 초기화 (00-init-artref.sh · artref-schema.sql)
├── docker-compose.local.yml          # 로컬 백엔드 스택 (MySQL · Valkey · backend · fastapi · guide)
├── docker-compose.observability.yml  # overlay — 로컬 LGTM 관측 스택
└── docker-compose.ga4.yml            # overlay — GA4 credentials
```

> Terraform state 는 S3 원격 백엔드(`drawe-tfstate-<account>`)에 저장되어, 작업 디렉터리와 무관하게 동일 state 를 공유합니다.

## 환경 비교

| 항목     | dev                        | prod                               |
| ------ | -------------------------- | ---------------------------------- |
| AWS 계정 | 분리 운영                      | 분리 운영                              |
| 운영 시간  | 스케줄 자동 on/off (비용 절감) | 24/7 (노드 스케일로 비활성 절감)            |
| NAT    | NAT instance (`t4g.micro`) | fck-nat Multi-AZ (ASG)             |
| Redis  | EC2 Valkey                 | ElastiCache                        |
| 관측     | Grafana Cloud              | AMP + self-host Grafana/Loki/Tempo |
| 알람     | Discord webhook (SNS → Lambda)     | 동일                       |
| 컴퓨트    | **EKS · Karpenter · Graviton ARM64** | 동일               |
| 노드     | on-demand + spot 혼용, 다종 인스턴스(m6g/m7g/c6g/c7g/r6g) | 동일 |
| 벡터 저장소 | Pinecone(챗) · Qdrant Cloud(가이드) | 동일                        |

## 🧭 왜 이렇게 구성했나 (설계 의도)

> 아래는 현재 구성의 **의도·트레이드오프**를 정리한 것입니다. 일부는 일반적인 근거에 기반하므로, 실제 팀 결정과 다른 부분은 바로잡아 주세요.

### 공통 선택

| 결정 | 이유 |
| --- | --- |
| **EKS (ECS 에서 전환)** | 노드 스케일을 스케줄러에 직결(반응성), Karpenter 로 워크로드 맞춤 인스턴스를 동적 선택(빈패킹·spot), ArgoCD GitOps 무중단, dev/prod 운영모델 통일. ECS 도 오토스케일은 있었으나 *방식 고도화* |
| **Karpenter + HPA (2계층)** | 파드는 HPA, 노드는 Karpenter. NodePool 에 on-demand+spot 혼용·다종 인스턴스(m6g/m7g/c6g/c7g/r6g)를 열어 비용↓·spot 중단 분산 |
| **Graviton / ARM64** | 동급 x86 대비 가격·전력 효율 우위. 컨테이너 이미지도 ARM64 빌드 |
| **가이드 서비스 = ClusterIP 내부 전용** | 가이드 API 는 backend 만 호출 → ALB/공인 엔드포인트 불필요. 클러스터 내부 DNS 로만 노출해 공격면·비용 축소 |
| **ALB Ingress 그룹 단일화(group=drawe-prod)** | api·grafana 등이 ALB 1개를 공유 → 비용·관리 단순화 |
| **ArgoCD GitOps** | `main` = 배포 상태. git push → auto-sync(prune+selfHeal) 롤링. 배포 이력·롤백이 git 으로 추적 |
| **IRSA (파드 단위 IAM)** | 노드 공유 권한 대신 파드별 최소권한. AWS 키 비저장 |
| **External Secrets(ESO) + SSM** | SSM SecureString 을 ESO 가 런타임 주입. 시크릿을 매니페스트/레포에 두지 않음 |
| **벡터 백엔드 분리 (Pinecone / Qdrant)** | 챗 레퍼런스와 가이드 코퍼스는 데이터·수명주기가 다름 → 분리. Qdrant 는 무료 클러스터 keep-alive 로 유지 |
| **Terraform (IaC, S3 remote state)** | 환경 재현성·코드 리뷰·drift 관리. dev/prod 일관 구성 |
| **Cloudflare + ALB** | Cloudflare 가 DNS·CDN·DDoS·edge TLS, ALB 가 EKS 타깃 L7 라우팅 |

### dev / prod 를 다르게 둔 이유

[환경 비교](#환경-비교) 표의 차이는 대부분 **dev = 비용 최소화 / prod = 가용성·운영 안정성** 라는 트레이드오프에서 나옵니다.

| 항목 | dev 가 다른 이유 (트레이드오프) |
| --- | --- |
| **AWS 계정 분리** | blast radius·IAM 권한·청구를 환경별로 격리. 실수로 prod 를 건드릴 위험 차단 |
| **NAT** | dev 는 NAT instance(`t4g.micro`)로 최저 비용. prod 는 fck-nat Multi-AZ(ASG)로 HA·자동 복구 확보 (비용 ↔ 가용성) |
| **Redis** | dev 는 EC2 Valkey 자체 운영으로 저렴. prod 는 ElastiCache 로 관리형 HA·백업·운영 부담 절감 |
| **관측성** | dev 는 Grafana Cloud 로 무운영(프리 티어로 충분). prod 는 AMP + self-host 로 대규모 시 SaaS 단가 통제·데이터 소유권 확보 |

## 트래픽 흐름

```text
User → Cloudflare → ALB Ingress (group=drawe-prod) → EKS
                          ├── Backend (ClusterIP)
                          │     ├── FastAPI · embed  (ClusterIP, 내부)
                          │     └── FastAPI · guide   (ClusterIP, 내부)
                          └── Alloy (DaemonSet, 노드당 1)

FastAPI · guide → Qdrant Cloud(가이드 ref) · RDS drawe_guide(성장/로그) · S3(참고 이미지/에셋)
관측: Alloy → 로그 Loki(S3) · 트레이스 Tempo(S3) · 메트릭 AMP → Grafana
```

가이드 서비스는 **ALB 를 거치지 않고** backend 가 클러스터 내부(ClusterIP/내부 DNS)로 호출합니다. dev / prod 는 동일 구조이며 observability destination 만 다릅니다.

## 로컬 스택

전체 백엔드 스택(MySQL · Valkey · backend · fastapi·embed · fastapi·guide)을 docker-compose 로 띄웁니다.

```bash
docker compose -f docker-compose.local.yml up -d
```

| 포트 | 서비스 |
| --- | --- |
| 3306 | MySQL |
| 6379 | Valkey |
| 8080 | Backend (Spring Boot) |
| 8000 | FastAPI · embed |
| 8001 | FastAPI · guide (이미지 가이드) |

> 가이드 서비스는 자체 DB(`drawe_guide`)·Qdrant·S3 가 필요합니다. 로컬에서 가이드 소스(artref) 코퍼스를 다룰 때는 `local-init/` 의 초기화 스크립트를, dev 스토어로 적재할 때는 [`runbooks/dev_store_backfill.md`](runbooks/dev_store_backfill.md) 를 참고하세요.

### 로컬 관측 스택 (선택)

```bash
docker compose -f docker-compose.local.yml -f docker-compose.observability.yml up -d
```

| 포트 | 서비스 |
| --- | --- |
| 3000 | Grafana UI (anonymous Admin) |
| 4317 | OTLP gRPC (otel-lgtm) |
| 4318 | OTLP HTTP (otel-lgtm) |

`grafana/otel-lgtm` 단일 이미지로 Loki/Tempo/Prometheus/Grafana 일괄 제공.
앱은 컴포즈 환경변수로 OTLP endpoint 가 자동 주입.

### 로컬 데이터 시드 (선택)

1. 공유 스토리지에서 `reference_data.sql` 을 받아 `infra/` 에 둡니다.
   (18MB 라 git 에는 없습니다 — PII 없는 images/image_drawe_tags 만 포함)
2. 스택을 띄운 뒤 시드 스크립트 실행:
   ```bash
   bash scripts/seed-local.sh
   ```

스키마는 백엔드 Flyway 가 만들고, 이 스크립트가 reference 데이터 + 온보딩 시드를 적재합니다. onboarding 이 12 면 정상.

## 배포 (Terraform)

### Prerequisites

* Terraform >= 1.5
* AWS CLI v2
* AWS 인증 설정 (`aws configure`, SSO, IAM Identity Center 등)
* Cloudflare API Token 필요

### dev / prod

dev 는 `terraform-dev/`, prod 는 `terraform-prod/` 에서 동일한 절차로 실행합니다.

```bash
cd terraform-dev          # 또는 terraform-prod

cp terraform.tfvars.example terraform.tfvars
export CLOUDFLARE_API_TOKEN="<token>"

terraform init
terraform plan -out tfplan
terraform apply tfplan
```

### apply 후 1회 — 시크릿 placeholder 실값 주입

Terraform 으로 SSM SecureString 을 만들 때 placeholder (`CHANGE_ME_*`) 가 박혀 있고 `lifecycle.ignore_changes = [value]` 라 state 에 평문이 안 들어갑니다. apply 직후 한 번 실값을 주입합니다.

```bash
# 어드민 비밀번호 (Spring Boot 어드민 콘솔)
aws ssm put-parameter --name "/drawe/<env>/admin-password" \
  --value "$(openssl rand -base64 24)" \
  --type SecureString --overwrite

# Grafana 어드민 비밀번호 (self-host prod 만)
aws ssm put-parameter --name "/drawe/prod/grafana-admin-password" \
  --value "$(openssl rand -base64 24)" \
  --type SecureString --overwrite

# Discord 웹훅 URL (dev / prod 각각)
aws ssm put-parameter --name "/drawe/<env>/discord-webhook-url" \
  --value "https://discord.com/api/webhooks/..." \
  --type SecureString --overwrite

# 해당 서비스에 새 secret 반영 (ESO 동기화 후 롤링 재시작)
kubectl -n drawe rollout restart deploy/backend
```

#### 가이드 서비스 시크릿 (fastapi·guide)

가이드 task 는 다음 SSM 파라미터를 `valueFrom` 으로 주입받습니다. 모두 placeholder 로 생성되므로 apply 후 실값을 1회 주입합니다(주입 후 새 task 가 기동 시 자동 반영).

| 컨테이너 env | SSM 파라미터 | 타입 | 값 |
| --- | --- | --- | --- |
| `DB_DSN` | `/drawe/<env>/artref-db-dsn` | SecureString | `mysql+pymysql://drawe_guide:***@<rds>:3306/drawe_guide` |
| `QDRANT_URL` | `/drawe/<env>/qdrant-url` | String | `https://<cluster>.qdrant.io:6333` (포트 명시, 끝 슬래시 없음) |
| `QDRANT_API_KEY` | `/drawe/<env>/qdrant-api-key` | SecureString | Qdrant Cloud 키 |
| `XAI_API_KEY` | `/drawe/<env>/grok-api-key` | SecureString | Grok(코칭 LLM) 키 |
| `GEMINI_API_KEY` | `/drawe/<env>/gemini-api-key` | SecureString | Gemini(손 VLM) 키 |

```bash
# 예시 — Qdrant URL (포트 6333 명시, 끝 슬래시 없음)
aws ssm put-parameter --name "/drawe/dev/qdrant-url" \
  --value "https://<cluster>.qdrant.io:6333" --type String --overwrite
```

> **Qdrant keepalive (GitHub Actions)** — `qdrant-keepalive` 워크플로는 SSM 이 아니라 **레포 시크릿** `QDRANT_URL` · `QDRANT_API_KEY` 를 사용합니다(무료 클러스터 비활성 방지 핑). 값은 위 SSM 과 동일합니다.

#### 가이드 스키마 · 스토어 백필

- `drawe_guide` 스키마는 가이드 서비스의 마이그레이션 러너가 적용합니다(`GUIDE_AUTO_MIGRATE=1` 또는 `python -m guide.stores.migrate`).
- dev 코퍼스(레퍼런스 행 + S3 에셋) 적재 절차는 [`runbooks/phase3_dev_store_backfill.md`](runbooks/phase3_dev_store_backfill.md) 참고(Qdrant 차원 768 게이트 → S3 복사 → RDS 적재 → 검증).

## 📡 관측성 (Observability)

OpenTelemetry 기반으로 trace · log · metric 을 수집합니다. **Alloy**(DaemonSet, 노드당 1)가 앱의 OTLP(4317/4318)를 받아 환경별 destination 으로 전달합니다(dev → Grafana Cloud / prod → AMP + self-host).

```mermaid
flowchart LR
  BE[Backend] -. OTLP .-> AL[Alloy<br/>DaemonSet]
  FA[FastAPI · embed] -. OTLP .-> AL
  GA[FastAPI · guide] -. OTLP .-> AL
  AL -->|dev| GC[Grafana Cloud]
  AL -->|prod| SH[AMP + self-host<br/>Grafana · Loki(S3) · Tempo(S3)]
```

**✅ 완료 — 인프라 + 앱 계측 + 알람**
- Alloy 수집 파이프라인 (DaemonSet 구조, OTLP 수신)
- 환경별 destination 분리 (dev → Grafana Cloud / prod → AMP + self-host)
- 외부 전송 전 **PII redaction** 규칙 (이메일·토큰·LLM 프롬프트 본문 등 삭제/해싱, user.id 는 1회 해시·session.id 는 opaque, 수집기 재해시 없음)
- prod self-host 스택 배포 (Loki / Tempo / Grafana + AMP) 및 종단 검증
- Grafana → AMP SigV4 query 인증 (`GF_AUTH_SIGV4_AUTH_ENABLED`)
- Daemon Alloy 의 컨테이너 stdout → Loki 수집 (`service_name=drawe/infra-daemon`)
- Spring Boot 자동 계측 (OTel Java Agent + JSON 로그 + Micrometer 커스텀 카운터)
- FastAPI(embed·guide) 자동 계측 (opentelemetry-distro + opentelemetry-instrument)
- 로컬 관측성 스택 (otel-lgtm 단일 이미지) 배선
- SNS → Lambda → Discord 알람 (4xx/5xx/RDS CPU/스토리지/NAT/ALB unhealthy target 등)

**🚧 진행 중 — 운영 폴리시**
- RED 대시보드 (Rate · Errors · Duration) — Alloy spanmetrics connector 기반
- admin 대시보드 ↔ Grafana/Loki 딥링크 (session_id/trace_id)
- RED 대시보드 자리 / actuator scrape 정리 (Alloy DaemonSet 기준)
- §C 자동 발화 부하 테스트 검증 (현재 자연 트래픽 0 으로 4xx 알람 임계치 미달)

**✅ 완료 — EKS 이관 (ROUND2)**
- ECS → **EKS(drawe-prod, K8s 1.35)** 전환 — Karpenter(노드) + HPA(파드) 2계층 오토스케일
- **ArgoCD GitOps** 무중단 배포(롤링 + PDB + readiness)
- self-host LGTM 관측(Alloy DaemonSet → 로그 Loki/S3 · 트레이스 Tempo/S3 · 메트릭 AMP) + Grafana(grafana.drawe.xyz)
- ESO(External Secrets) + SSM 시크릿 주입, IRSA 파드 단위 권한

### 어드민 대시보드

내부 운영자용 Thymeleaf 대시보드 (인메모리 계정 1개).

```
URL:        https://api.drawe.xyz/admin/login   (prod)
            https://api-dev.drawe.xyz/admin/login (dev)
Username:   admin
Password:   SSM /drawe/<env>/admin-password
```

비밀번호 조회 / 재설정:
```bash
# 조회
aws ssm get-parameter --name "/drawe/prod/admin-password" \
  --with-decryption --query 'Parameter.Value' --output text

# 재설정
aws ssm put-parameter --name "/drawe/prod/admin-password" \
  --value "$(openssl rand -base64 24)" \
  --type SecureString --overwrite
kubectl -n drawe rollout restart deploy/backend   # ESO 재동기화 후 새 secret 반영
```

## 참고 사항

* EKS 노드는 Graviton ARM64 기반으로 운영 (Karpenter 가 m6g/m7g/c6g/c7g/r6g 중 동적 선택)
* 컨테이너 이미지도 ARM64 호환 빌드 필요 (`docker buildx --platform linux/arm64`) — 가이드 이미지(`Dockerfile.guide`)는 torch/open_clip/mediapipe 포함으로 빌드가 무겁습니다
* 주요 시크릿은 AWS SSM Parameter Store (SecureString) 로 관리하고 **ESO(External Secrets)** 가 파드에 주입, `lifecycle.ignore_changes = [value]` 로 평문이 state 에 들어가지 않음
* Alloy config 는 gzip + base64 로 압축 저장 (`scripts/upload-alloy-config.sh` 또는 terraform `base64gzip` 자동)
* 노드/컨테이너 디버깅은 `kubectl exec` / `kubectl debug` 로 진입 (SSH 22 미개방)
* 배포는 **ArgoCD GitOps** — git push → overlay tag bump → auto-sync 롤링. 수동 동기화는 `argocd app sync <app>` 또는 `kubectl -n drawe rollout restart deploy/<name>`

## 관련 문서

- [루트 README](../README.md) — 전체 아키텍처·CI/CD
- [`backend/README.md`](../backend/README.md) · [`fastapi/README.md`](../fastapi/README.md) · [`frontend/README.md`](../frontend/README.md)