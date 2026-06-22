# Prod EKS Migration Cutover Runbook

> 본 문서는 실제 수행된 컷오버 절차와 운영 중 확인된 Known Issues 를 함께 기록한다.
> 컷오버 절차(D-day 순서) → 장애 사례(함정) → 설계 결정 순서로 구성됨.
> 한 번 실행한 작업이지만 향후 staging 신설·DR 재구축·신규 인원 온보딩에 사용.

## ⚠️ Terraform State 구조

같은 S3 bucket (`drawe-tfstate-933832340498`) 의 서로 다른 key 로 분리.
**`terraform-prod` 는 데이터 계층(RDS/ElastiCache/SSM) 소유 — 절대 destroy 금지.**

| 레이어 | State key | 소유 자원 |
| --- | --- | --- |
| `terraform-prod` | `drawe/prod/terraform.tfstate` | VPC, RDS, ElastiCache, SSM, NAT, S3, ECS(정지 중), Cloudflare DNS |
| `eks/prod/2-cluster` | `eks/prod/cluster/terraform.tfstate` | EKS 컨트롤플레인, 시스템 NG, OIDC, ebs-csi/vpc-cni/coredns/kube-proxy addon |
| `eks/prod/3-platform` | `eks/prod/platform/terraform.tfstate` | ALB Controller, Karpenter, ESO, ArgoCD, IRSA, pods-db SG, RDS/Redis SG ingress |

EKS 가 데이터 계층 자원을 read-only 로 읽는 구조 → terraform-prod state 에 의존.
EKS 만 부수고 다시 만드는 건 안전. `terraform-prod` destroy 는 RDS/Redis/SSM **영구 손실**.

## 큰 그림

데이터(RDS, ElastiCache, SSM)는 ECS·EKS 가 공유. 컴퓨트만 ECS → EKS 로 교체.
ECS·EKS 공존 상태를 만든 뒤 DNS 만 EKS 로 돌리는 blue/green 컷오버.

```
사용자
  │
  ▼
Cloudflare (api.drawe.xyz, proxied)
  │
  │   [컷오버 전]                [컷오버 후]
  ├──► ECS ALB                   EKS ALB ◄──┤
  │                                          │
  │                              Ingress (drawe-prod ns)
  │                              ALB Controller (kube-system)
  │                                ▼
  │                              Service
  │                                ▼
  │                              Pod (backend / fastapi-* )
  │                                │
  │                                ├─ SGP(SecurityGroupPolicy)
  │                                │   ▼
  │                                │  pods-db SG ── 3306/6379 ──┐
  │                                │                              │
  │                                └─ IRSA SA                     │
  │                                    │                          │
  └────────── 공유 데이터 계층 ───────┴──────────────────────────┤
              │                                                    │
              ▼                                                    ▼
       RDS (drawe-prod-mysql)                    ElastiCache Valkey
       SSM /drawe/prod/*  ◄── ESO ClusterSecretStore (IRSA)
       (terraform-prod 소유 — EKS 가 read-only 로 참조)
```

## 컴포넌트 버전 (재현성)

라이브 클러스터에서 확인된 실제 image 태그 (2026-06 기준).

| | Image / Version | Notes |
| --- | --- | --- |
| Kubernetes | 1.35 | 시스템 NG t4g.large, Karpenter 노드는 SGP 지원 패밀리만 |
| AWS Load Balancer Controller | `public.ecr.aws/eks/aws-load-balancer-controller:v2.17.1` | helm chart pin → `modules/eks-platform/alb-controller.tf` |
| Karpenter | `public.ecr.aws/karpenter/controller:1.6.3` | NodePool: arm64, m6g/m7g/c6g/c7g/r6g (t4g 제외, prod) |
| External Secrets Operator | `oci.external-secrets.io/external-secrets/external-secrets:v0.14.3` | ClusterSecretStore: aws-ssm, region ap-northeast-2, IRSA |
| ArgoCD | `quay.io/argoproj/argocd:v3.0.11` | targetRevision=main, ServerSideApply |

실제 핀된 chart 버전 갱신은 `modules/eks-platform/*.tf` 의 `helm_release.version` 블록 변경.
라이브 image 태그 재확인:

```bash
kubectl get deploy -n kube-system aws-load-balancer-controller -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl get deploy -n kube-system karpenter -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl get deploy -n external-secrets external-secrets -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl get deploy -n argocd argocd-server -o jsonpath='{.spec.template.spec.containers[0].image}'
```

## 사전 조건

- ECS 운영 중이거나 `prod_enabled=false` 로 꺼진 상태 (둘 다 가능)
- `terraform-prod` 의 outputs-eks-bridge 가 채워져 있음 (vpc, subnet, RDS SG, Redis SG, S3 policy ARN 등 8 개) — EKS 가 read-only 로 읽음
- SSM `/drawe/prod/*` 시크릿이 채워져 있음 (ESO 가 이걸 읽어 K8s Secret 만듦)
- ECR 에 prod 이미지 존재 (`drawe-prod-backend`, `drawe-prod-fastapi`, `drawe-prod-fastapi-guide`)
- prod AWS 자격증명 + Cloudflare 토큰
- kubectl 컨텍스트가 prod 클러스터인지 항상 확인 (`kubectl config current-context`)

## 사용하는 스크립트

운영용: `infra/scripts/prod-shared-infra.sh` — NAT / ElastiCache / RDS on·off 토글.
컷오버 산출물(terraform·k8s 매니페스트)은 모두 git 에 있어 별도 생성 스크립트 불필요.

## 컷오버 D-day 순서

### 1. 코드 머지

```
feature → develop → main
```

backend 변경(IRSA STS fix, spring-session-data-redis, REDIS_TLS) 이 prod 에 들어감.

### 2. 이미지 빌드

- main 머지가 `backend-cd.yml` 트리거
- prod environment 승인 후 "Docker 빌드 & ECR push" 단계가 새 latest+SHA push
- ECS task definition 갱신·service update 단계는 `prod_enabled=false` 면 무의미하지만 무해 (취소 가능)
- 확인:
  ```bash
  aws ecr describe-images --repository-name drawe-prod-backend --region ap-northeast-2 \
    --image-ids imageTag=latest --query 'imageDetails[0].imagePushedAt'
  ```

### 3. 공유 인프라 ON (RDS/Redis 가 꺼져 있던 경우)

```bash
bash infra/scripts/prod-shared-infra.sh --validate
```

### 4. EKS 클러스터 생성

```bash
cd infra/eks/prod/2-cluster
terraform init && terraform apply
aws eks update-kubeconfig --name drawe-prod --region ap-northeast-2
kubectl get nodes   # 시스템 노드 Ready
```

### 5. EKS 플랫폼 설치

```bash
cd ../3-platform
terraform init && terraform apply
kubectl get clustersecretstore aws-ssm   # Valid/Ready
kubectl get pods -n kube-system | grep -E "load-balancer|karpenter"
kubectl get pods -n argocd
```

ESO race 발생 시: `helm uninstall external-secrets -n external-secrets` → `terraform apply` 재실행. (함정 3 참조)

### 6. ⚠️ SG id 갱신 (EKS 재생성 시 필수)

EKS 를 새로 만들었으면 pods-db SG, 클러스터 SG id 가 새로 발급된다.
overlay 의 옛 SG id 를 새 값으로 교체하지 않으면 backend 가 RDS 에 못 붙는다 (함정 1, 4 참조).

```bash
NEW_CLUSTER=$(cd infra/eks/prod/2-cluster && terraform output -raw cluster_security_group_id)
NEW_PODSDB=$(cd infra/eks/prod/3-platform && terraform output -raw pods_db_security_group_id)
echo "cluster=$NEW_CLUSTER  pods-db=$NEW_PODSDB"

# overlay (backend, fastapi-guide) 의 옛 SG id 두 개를 새 값으로 교체
# (sed 또는 PowerShell. 줄바꿈 확인하고 git diff 로 SG 라인만 변경되는지 검증)

git add infra/k8s/overlays/prod
git commit -m "chore(prod): EKS 재생성에 따른 SG id 갱신"
git push origin main   # argocd 가 main 만 봄 (함정 8 참조)
```

### 7. 앱 등록 (ArgoCD Applications)

```bash
kubectl apply -f infra/k8s/argocd/apps/prod/
kubectl get applications -n argocd
kubectl get pods,externalsecret,ingress -n drawe-prod
```

확인:
- 파드: 1/1 Running
- ExternalSecret: SecretSynced=True
- Ingress: ALB DNS 생성

### 8. dark 검증 (Cloudflare 가 아직 ECS 가리킴)

```bash
TGARN=$(kubectl get targetgroupbindings -n drawe-prod \
  -o jsonpath='{.items[?(@.spec.serviceRef.name=="backend")].spec.targetGroupARN}')
aws elbv2 describe-target-health --region ap-northeast-2 --target-group-arn "$TGARN"
# 모든 타깃 healthy
```

ALB 직접 호출은 Ingress 의 `inbound-cidrs` 가 Cloudflare IP 전용이라 timeout — port-forward 로 검증:

```bash
kubectl port-forward -n drawe-prod svc/backend 8080:8080
curl http://localhost:8080/actuator/health/readiness   # UP
```

**readiness 통과만 보지 말고 로그도 확인** (readiness 통과해도 OAuth/SSM/Redis 재연결 오류가 숨어있을 수 있음):

```bash
kubectl logs deploy/backend -n drawe-prod --tail=200 | grep -iE "error|exception|timeout|failed"
# 깨끗하면 OK. Redis reconnect, OAuth, SSM secret 관련 라인이 있으면 멈추고 진단.
```

### 9. DNS 컷오버 (terraform apply)

`infra/terraform-prod/cutover-eks.tf` 와 `cloudflare.tf` 의 api 레코드 패치는 이미 git 에 있음.

```bash
cd infra/terraform-prod
terraform plan
# 예상: data.aws_lb.eks_ingress 1 개 read + cloudflare_record.api content 변경
terraform apply
```

### 10. 즉시 검증

```bash
curl -I https://api.drawe.xyz/actuator/health/readiness   # HTTP/2 200
```

브라우저로 OAuth 로그인 1 회 — 멀티파드 Valkey 공유 세션의 e2e 검증.
이게 성공해야 진짜 컷오버 완료.

## 핵심 의존성 (어기면 hard fail)

- 9 번의 `data.aws_lb.eks_ingress` 는 7 번에서 ALB 가 실제 생성된 뒤에만 resolve. 순서 어기면 `Search returned no results` 즉시 실패.
- 7 번의 ArgoCD → ALB controller → Ingress → ALB → target group chain 통과해야 8 번이 의미 있음.
- argocd 앱들의 `targetRevision` 이 `main` — 6 번 push 가 7 번 apply 전에 끝나야 함. (함정 8)
- SecurityGroupPolicy 는 SGP 지원 인스턴스에서만 동작 (t4g/t3 미지원, 함정 1).

## 성공 기준 (Success Criteria)

컷오버 완료 선언 조건:

- [ ] backend 2개 파드 `1/1 Ready`, RESTARTS 0 (5분 이상 안정)
- [ ] fastapi-embed `1/1 Ready`
- [ ] fastapi-guide `1/1 Ready`
- [ ] ArgoCD 3개 앱 모두 `Synced` + `Healthy`
- [ ] ExternalSecret 모두 `SecretSynced=True`
- [ ] ClusterSecretStore aws-ssm `Ready=True`
- [ ] ALB target group: backend 타깃 모두 healthy
- [ ] `curl -I https://api.drawe.xyz/actuator/health/readiness` → HTTP/2 200
- [ ] 브라우저 OAuth 로그인 1 회 성공 (멀티파드 Valkey 공유 세션 e2e)
- [ ] 기존 사용자 로그인 → 정상 페이지 로드
- [ ] **backend 로그에 `Communications link failure` / `Connect timed out` (DB) 없음**
- [ ] **backend 로그에 Redis SSL handshake / authentication 오류 없음**
- [ ] backend 로그에 ERROR/FATAL 없음 (5분 관찰)
- [ ] Cloudflare Analytics 에서 5xx 비율 < 0.5% (10분)

## 롤백

| 단계 | 증상 | 롤백 |
| --- | --- | --- |
| 9 직후 | api.drawe.xyz 5xx 지속 | `terraform apply -var='eks_cutover=false'` → ECS ALB 로 원복. `prod_enabled=false` 면 그쪽도 503 → 진짜 롤백은 ECS 재기동(`prod_enabled=true` apply) 필요 |
| 7 단계 문제 | 앱이 떴는데 비정상 | `kubectl delete -f infra/k8s/argocd/apps/prod/` → 앱만 내림 (EKS·플랫폼은 유지) |
| 4~5 단계 문제 | 클러스터·플랫폼 자체 문제 | `terraform destroy` (eks/prod/3-platform → 2-cluster). **terraform-prod 는 절대 안 건드림** (RDS·Redis·SSM 영구 손실) |

## 자주 부딪힌 함정 (실제 장애 기록)

### 1. SGP 미작동 — backend RDS connect timeout

**증상**: backend 파드 CrashLoopBackOff. 스택트레이스에 `Caused by: java.net.SocketTimeoutException: Connect timed out` (MySQL connector). 이게 JPA `entityManagerFactory` → Tomcat 시작 실패 → liveness probe(8080) refused 로 도미노.

**진단**: `kubectl describe pod` 의 annotation 에 `vpc.amazonaws.com/pod-eni` 가 **없음**.
즉 SecurityGroupPolicy 가 파드에 안 붙어서 노드 기본 SG 로 통신 → RDS SG ingress 에 없음 → timeout.

```bash
# pod-eni annotation 확인 (있어야 SGP 작동)
POD=$(kubectl get pod -n drawe-prod -l app=backend -o name | head -1)
kubectl get $POD -n drawe-prod -o yaml | grep "vpc.amazonaws.com/pod-eni"

# 노드 인스턴스 타입 (SGP 지원 여부)
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.labels.node\.kubernetes\.io/instance-type}{"\n"}{end}'

# SGP 가 실제로 매칭됐는지
kubectl describe pod $POD -n drawe-prod | grep -i security
```

**원인**:
- Karpenter NodePool 에 t4g 포함 → backend 가 t4g 에 떨어지면 SGP 미지원 인스턴스라 무시됨
- 시스템 노드그룹(t4g.large)에 taint 없음 → backend 가 시스템 노드로도 갈 수 있음

**해결 (코드 영구 반영)**:
- `modules/eks-cluster/system-nodegroup.tf` — `CriticalAddonsOnly:NoSchedule` taint
- `eks/prod/3-platform/main.tf` — `karpenter_instance_families = ["m6g", "m7g", "c6g", "c7g", "r6g"]` (t4g 제외, prod 만)

**왜 t4g 가 SGP 미지원**: t4g/t3 같은 버스터블은 ENI Trunking 미지원. SGP 는 trunk ENI 위에 branch ENI 를 붙이는 방식이라 trunk 없으면 동작 X. m/c/r 같은 nitro 인스턴스만 지원.

### 2. REDIS_SSL vs REDIS_TLS

**증상**: backend 가 ElastiCache 에 붙으려다 handshake 실패 → 시작 실패.

**원인**: backend 의 `application.properties` 는 `spring.data.redis.ssl.enabled=${REDIS_TLS:false}` 를 읽는데, overlay 에 `REDIS_SSL=true` 로 박혀 있어 환경변수 이름 불일치 → TLS 꺼진 채 TLS 필수 ElastiCache 접근.

**해결**: overlay 의 환경변수를 `REDIS_TLS=true` 로 수정.

**교훈**: 앱 코드가 보는 env 키 이름을 overlay 작성 전 반드시 확인 (`git grep "spring.data.redis"`).

### 3. ESO bootstrap race

**증상**: 3-platform `terraform apply` 가 External Secrets Operator 설치 단계에서 멈춤. ESO 가 자기 Service 를 만들 때 ALB Ingress Controller 의 webhook 을 거치는데 그 webhook endpoint 가 아직 없어서 실패.

**원인**: terraform 이 `helm_release.alb_controller` 와 `helm_release.external_secrets` 를 거의 동시 적용.

**해결 (코드 영구 반영)**: `modules/eks-platform/external-secrets.tf` 와 `argocd.tf` 의 `helm_release` 에 `depends_on = [helm_release.alb_controller]`.

**재발 시 응급조치**:
```bash
helm uninstall external-secrets -n external-secrets
cd infra/eks/prod/3-platform && terraform apply
```

### 4. EKS 재생성 시 SG id 변경

**증상**: EKS destroy → recreate 후 backend 가 RDS timeout. SG 규칙 자체는 정상으로 보임.

**원인**: EKS 부수면 pods-db SG, 클러스터 SG 가 함께 삭제됨. 재생성 시 새 id 발급. overlay (`backend/kustomization.yaml`, `fastapi-guide/kustomization.yaml`) 의 `SecurityGroupPolicy.spec.securityGroups.groupIds` 에 옛 id 가 박혀 있어 무효.

**해결 (절차 반영)**: 컷오버 6 번 단계에 SG id 갱신 → main push 절차 명시.

**향후 개선 여지**: overlay 를 직접 SG id 박지 말고 ApplicationSet 또는 Helm 으로 terraform 출력 주입. 현재 kustomize 구조 변경이 큰 작업이라 보류.

### 5. CRLF plan 노이즈

**증상**: terraform plan 에 heredoc output(예: `next_steps`) 이 전 줄 변경으로 떠 보임. 실제 자원 변경 없음.

**원인**: Windows 워킹트리 + WSL terraform 섞어 쓸 때 git autocrlf 가 LF→CRLF 변환 → terraform 이 CRLF 로 읽어 state 의 LF 와 비교.

**해결 (코드 영구 반영)**: `infra/.gitattributes` 에 `*.tf text eol=lf` 등.

**기존 파일은**: `git add --renormalize infra/` 로 한 번 정규화.

### 6. 모노레포 ↔ flat 동기화 사고

**증상**: `rsync -av infra/ → drawe-deploy/` 한 번에 800MB 옮겨지고, flat 의 `terraform init` 결과가 모노레포의 것으로 덮여서 "backend reinit required" 에러.

**원인**: `.terraform/` (provider 바이너리), `terraform.tfvars` (비밀값), `.terraform.lock.hcl` 까지 전부 sync.

**해결 (절차 반영)**: sync 시 항상 exclude:
```bash
rsync -av \
  --exclude='.terraform/' --exclude='.terraform.lock.hcl' \
  --exclude='.build/' --exclude='*.tfstate*' --exclude='terraform.tfvars' \
  /mnt/c/Temp/gp/team-monorepo/drawe/infra/ ~/projects/drawe-projects/drawe-deploy/
```

**근본 개선 (보류)**: 모노레포에서만 terraform 돌리고 flat 없애는 게 정석. 마이그레이션이 큰 작업이라 컷오버 후 정리.

### 7. 시스템 노드에 워크로드 파드 떨어짐

**증상**: backend 가 시스템 노드그룹(t4g.large) 에 스케줄. 함정 1 과 같이 발현.

**원인**: 시스템 NG 에 taint 없어서 일반 워크로드도 거기 갈 수 있음. EKS 가 자동으로 system taint 안 검 (의도된 동작).

**해결**: 함정 1 과 같이 `CriticalAddonsOnly:NoSchedule` taint. NoSchedule 이라 기존 파드는 evict 안 됨, 새 스케줄만 막음.

**fastapi-embed 가 시스템 노드에 떠도 OK**: SGP 안 쓰는 파드는 시스템 노드 가도 무방.

### 8. ArgoCD targetRevision 의 main 의존성

**증상**: feature 브랜치에 prod overlay push 후 ArgoCD 가 `ComparisonError: path infra/k8s/overlays/prod/<app> does not exist at main`.

**원인**: `argocd/apps/prod/<app>.yaml` 의 `spec.source.targetRevision` 이 `main`. main 에 overlay 없으면 ArgoCD 가 못 찾음.

**해결**: 컷오버 6 번 단계에서 SG id 갱신 후 반드시 main push. dev 라면 develop 으로 — prod 와 다름.

### 9. main CD 가 ECS 를 가리킴 (현재 상태, 임시)

**현재**: main push 가 `backend-cd.yml` 의 ECS task definition update 단계까지 트리거. `prod_enabled=false` 라 무해하지만 잡음.

**정상화 작업 (Phase B)**: `backend-cd.yml` 의 prod 분기를 EKS GitOps 로 전환 — "ECR push 후 overlay 의 newTag 를 SHA 로 bump → commit → ArgoCD 가 동기화" 패턴. dev 와 동일.

## 결정 기록

| 날짜 | 결정 | 이유 |
| --- | --- | --- |
| 2026-06 | EKS 1.35 신규 생성(업그레이드 X) | dev·prod 둘 다 destroy → 재생성 사이클이라 1.35 로 직접 생성 |
| 2026-06 | RDS·ElastiCache·SSM 은 terraform-prod 유지 | 데이터 손실 위험 회피. ECS·EKS 공존이 핵심 |
| 2026-06 | k8s overlay 에 SG id 하드코딩 | kustomize 의 변수 주입 제한적. 빠른 컷오버 우선 |
| 2026-06 | Karpenter t4g 제외 (prod 만) | SGP 가 t4g 미지원 → 사고 영구 방지. dev 는 비용 위해 t4g 유지 |
| 2026-06 | argocd.targetRevision = main | prod 환경 main 머지 = 배포 게이트. develop 은 dev 전용 |

## 컷오버 후 남은 작업

- observability (Alloy DaemonSet) prod overlay
- prod CD 를 EKS GitOps 로 전환 (overlay newTag SHA bump)
- terraform 코드 위생 (versions.tf, partial backend, 죽은 코드 정리, tfvars.example 대칭)
- ECS 결합 종착지 결정 + ECS 리소스 정리 (RDS/Redis/SSM 은 절대 건드리지 말 것)