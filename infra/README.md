# infra — 배포 인프라

Drawe 서비스의 AWS 인프라를 Terraform 으로 관리합니다. 모노레포 `infra/` 디렉터리에 위치합니다.

> 현재 인프라 구조를 지속적으로 개선 중이며, 구성과 비용 전략은 프로젝트 진행에 따라 변경될 수 있습니다.

dev / prod 환경을 별도 AWS 계정으로 운영하며, ECS EC2 (Graviton ARM) 기반으로 애플리케이션과 observability 스택을 구성합니다.

## 핵심 설계

* dev / prod 별도 AWS 계정 운영
* ECS EC2 + Graviton (`t4g.*`) 기반 비용 최적화
* Terraform 기반 IaC 관리
* Alloy 기반 OpenTelemetry 수집 (DAEMON + sidecar 구조)
* Cloudflare + ALB 기반 HTTPS 구성
* dev 환경은 EventBridge 스케줄 기반 자동 on/off 로 비용 절감

## 디렉토리 구조

```text
infra/
├── terraform-dev/                    # dev 환경 Terraform
├── terraform-prod/                   # prod 환경 Terraform
├── configs/                          # Alloy / Grafana / Loki / Tempo config
├── scripts/                          # 운영 보조 스크립트 (seed-local.sh 등)
├── docker-compose.local.yml          # 로컬 백엔드 스택 (MySQL · Valkey · backend · fastapi)
├── docker-compose.observability.yml  # overlay — 로컬 LGTM 관측 스택
└── docker-compose.ga4.yml            # overlay — GA4 credentials
```

## 환경 비교

| 항목     | dev                        | prod                               |
| ------ | -------------------------- | ---------------------------------- |
| AWS 계정 | 분리 운영                      | 분리 운영                              |
| 운영 시간  | 평일 13:00~18:00 KST         | 24/7                               |
| NAT    | NAT instance (`t4g.micro`) | fck-nat Multi-AZ (ASG)             |
| Redis  | EC2 Valkey                 | ElastiCache                        |
| 관측     | Grafana Cloud              | AMP + self-host Grafana/Loki/Tempo |
| 컴퓨트    | ECS EC2 · Graviton (`t4g.*`, ARM64) | 동일                       |

## 🧭 왜 이렇게 구성했나 (설계 의도)

> 아래는 현재 구성의 **의도·트레이드오프**를 정리한 것입니다. 일부는 일반적인 근거에 기반하므로, 실제 팀 결정과 다른 부분은 바로잡아 주세요.

### 공통 선택

| 결정 | 이유 |
| --- | --- |
| **ECS on EC2 (not Fargate)** | 상시 워크로드의 컴퓨트 단가 통제 — 예약/스팟 여지가 있는 EC2 가 Fargate 대비 저렴. 인스턴스 레벨 제어도 확보 |
| **Graviton / ARM64 (`t4g.*`)** | 동급 x86 대비 가격·전력 효율 우위. 버스터블(`t4g`)이라 변동·저부하 트래픽에 적합 |
| **Terraform (IaC)** | 환경 재현성·코드 리뷰·drift 관리. dev/prod 를 같은 방식으로 일관되게 구성 |
| **Cloudflare + ALB** | 역할 분리 — Cloudflare 가 DNS·CDN·DDoS·edge TLS, ALB 가 ECS 타깃 L7 라우팅을 담당 |
| **SSM Parameter Store (SecureString)** | Secrets Manager 대비 비용 절감(표준 파라미터 무료). 시크릿 규모가 크지 않아 충분 |
| **`task_definition` `ignore_changes` + 수동 force deploy** | **배포 주체는 CD 파이프라인**(GitHub Actions). Terraform 이 TD 까지 관리하면 매 배포마다 drift·충돌이 나므로, TD 변경은 무시하고 이미지 갱신은 CD 가 force deployment 로 처리 |
| **ECS Exec 활성화** | SSH/베스천 없이 실행 중 컨테이너에 진입해 디버깅 |
| **Alloy config gzip + base64** | 파라미터/환경변수로 config 를 컴팩트하게 주입 (크기 제약 회피) |

### dev / prod 를 다르게 둔 이유

[환경 비교](#환경-비교) 표의 차이는 대부분 **dev = 비용 최소화 / prod = 가용성·운영 안정성** 라는 트레이드오프에서 나옵니다.

| 항목 | dev 가 다른 이유 (트레이드오프) |
| --- | --- |
| **AWS 계정 분리** | blast radius·IAM 권한·청구를 환경별로 격리. 실수로 prod 를 건드릴 위험 차단 |
| **운영 시간 (dev on/off)** | dev 는 24/7 일 필요가 없음 → EventBridge 로 개발 시간대(평일 13–18시)만 가동해 컴퓨트 비용 절감 |
| **NAT** | dev 는 NAT instance(`t4g.micro`)로 최저 비용. prod 는 fck-nat Multi-AZ(ASG)로 HA·자동 복구 확보 (비용 ↔ 가용성) |
| **Redis** | dev 는 EC2 Valkey 자체 운영으로 저렴. prod 는 ElastiCache 로 관리형 HA·백업·운영 부담 절감 |
| **관측성** | dev 는 Grafana Cloud 로 무운영(프리 티어로 충분). prod 는 AMP + self-host 로 대규모 시 SaaS 단가 통제·데이터 소유권 확보 |

## 트래픽 흐름

```text
User → Cloudflare → ALB → ECS
                          ├── Backend (+ alloy sidecar)
                          ├── FastAPI (+ alloy sidecar)
                          └── alloy-daemon (DAEMON, host당 1)
```

dev / prod 는 동일 구조이며 observability destination 만 다릅니다.

## 로컬 스택

전체 백엔드 스택(MySQL · Valkey · backend · fastapi)을 docker-compose 로 띄웁니다.

```bash
docker compose -f docker-compose.local.yml up -d
```

| 포트 | 서비스 |
| --- | --- |
| 3306 | MySQL |
| 6379 | Valkey |
| 8080 | Backend (Spring Boot) |
| 8000 | FastAPI |

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

## 📡 관측성 (Observability)

OpenTelemetry 기반으로 trace · log · metric 을 수집합니다. **Alloy**(daemon + sidecar)가 앱의 OTLP(4317/4318)를 받아 환경별 destination 으로 전달합니다(dev → Grafana Cloud / prod → AMP + self-host).

```mermaid
flowchart LR
  BE[Backend] -. OTLP .-> AL[Alloy<br/>sidecar + daemon]
  FA[FastAPI] -. OTLP .-> AL
  AL -->|dev| GC[Grafana Cloud]
  AL -->|prod| SH[AMP + self-host<br/>Grafana · Loki · Tempo]
```

**✅ 완료 — 수집·라우팅·보안 설계**
- Alloy 수집 파이프라인 (daemon + sidecar 구조, OTLP 수신)
- 환경별 destination 분리 (dev → Grafana Cloud / prod → AMP + self-host)
- 외부 전송 전 **PII redaction** 규칙 (이메일·토큰·LLM 프롬프트 본문 등 삭제/해싱)
- prod self-host config (Tempo / Loki / Grafana datasource)
- 로컬 관측성 스택 (self-host) 배선
- SNS → Lambda → Discord 알림 파이프

**🚧 진행 중 — 앱 계측**
- Spring Boot: OTel Java Agent 적용 + JSON 구조화 로그 (logstash-logback-encoder) + Micrometer 커스텀 카운터
- FastAPI: opentelemetry-distro 자동 계측

**📋 계획 — 대시보드·알람**
- RED 대시보드 (Rate · Errors · Duration) — Alloy spanmetrics connector 기반
- CloudWatch 4xx 알람 추가 (Discord 배선은 이미 적용됨)
- admin 대시보드 ↔ Grafana/Loki 딥링크 (session_id/trace_id)

> 즉 **수집·라우팅·보안(PII)·알람 채널 배선은 완료**, **앱 계측과 대시보드는 정비 중**인 단계입니다.

## 참고 사항

* ECS EC2 인스턴스는 ARM64 (`t4g.*`) 기반으로 운영
* 컨테이너 이미지도 ARM64 호환 빌드 필요 (`docker buildx --platform linux/arm64`)
* 주요 시크릿은 AWS SSM Parameter Store (SecureString) 로 관리
* Alloy config 는 gzip + base64 로 압축 저장
* ECS Exec 활성화 상태로 운영
* ECS service 의 `task_definition` 은 `ignore_changes` 처리되어 있어 수동 force deployment 방식 사용

## 관련 문서

- [루트 README](../README.md) — 전체 아키텍처·CI/CD
- [`backend/README.md`](../backend/README.md) · [`fastapi/README.md`](../fastapi/README.md) · [`frontend/README.md`](../frontend/README.md)