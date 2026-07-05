# Dev EKS Bring-up / Teardown Runbook

> dev(570515227314) EKS 는 **비용상 수동 on/off** 운용이 정본(EventBridge 스케줄 미사용).
> 필요할 때만 켜고, 끝나면 끈다. prod 컷오버(`prod_eks_cutover.md`)와 계층 구조는 같되,
> dev 는 **공유 인프라(NAT·Valkey)가 EC2 수동 on/off**라는 점이 핵심 차이.

## ★교훈 (2026-07, 이번 bring-up의 두 실패에서)

**dev 는 켤 때 공유 인프라 2종(NAT·Valkey)부터 켠다. 안 켜면 아래로 나타난다:**
- **NAT(drawe-dev-nat) 정지** → 프라이빗 노드가 ECR/API 도달 불가 → **노드그룹 CREATE_FAILED**("Instances failed to join the kubernetes cluster").
- **Valkey(drawe-dev-valkey) 정지** → backend 가 Redis 세션 스토어에 못 붙어 **readiness 실패**(RedisConnectionFailureException). MySQL 만 보고 넘어가면 놓친다.

둘 다 EC2 인스턴스 **stopped** 상태였고, 시동만으로 해소됨. → **0단계로 못박음.**

## 계층 (state)

| 레이어 | 소유 |
| --- | --- |
| `terraform-dev` | VPC, RDS, **NAT(EC2)·Valkey(EC2, self-hosted)**, SSM, ECS(dormant) — 데이터/공유 계층. destroy 주의(RDS/SSM). |
| `eks/dev/2-cluster` | EKS 컨트롤플레인, 시스템 NG(t4g.large), OIDC, addon |
| `eks/dev/3-platform` | ALB Controller, Karpenter, ESO, ArgoCD, IRSA, pods-db SG |

dev ArgoCD 는 **develop** 브랜치를 본다(prod=main).

## Bring-up 순서

### 0. 공유 인프라 ON (★필수 선행 — 안 하면 위 교훈대로 실패)

```bash
export AWS_PROFILE=drawe-dev
# NAT + Valkey 수동 시동
aws ec2 start-instances --instance-ids <drawe-dev-nat>  <drawe-dev-valkey>
# 2/2 상태검사 통과까지 대기 (둘 다)
aws ec2 wait instance-status-ok --instance-ids <drawe-dev-nat>
aws ec2 wait instance-status-ok --instance-ids <drawe-dev-valkey>
# 확인: 둘 다 running + InstanceStatus/SystemStatus = ok/ok
```
- RDS(drawe-dev-mysql)는 `available` 인지 확인(꺼져 있으면 start-db-instance 후 대기).
- 인스턴스 id 는 태그 `Name=*nat*` / `Name=*valkey*` 로 조회.

### 1. EKS 클러스터 (2-cluster)

```bash
cd infra/eks/dev/2-cluster
terraform init && terraform plan -out=p   # destroy 0 확인
terraform apply p
aws eks update-kubeconfig --name drawe-dev --region ap-northeast-2
kubectl get nodes   # 시스템 노드 Ready (0단계 NAT 켜야 조인됨)
```

### 2. 플랫폼 (3-platform)

```bash
cd ../3-platform
terraform init && terraform plan -out=p   # destroy 0 확인 (2-cluster apply 후여야 remote-state 해석됨)
terraform apply p
kubectl get clustersecretstore aws-ssm    # Ready=True (Valid)
kubectl get pods -n kube-system | grep -E "load-balancer|karpenter"
kubectl get pods -n external-secrets; kubectl get pods -n argocd
```

### 3. SG id 갱신 (EKS 재생성 필수)

```bash
NEW_PODSDB=$(cd infra/eks/dev/3-platform && terraform output -raw pods_db_security_group_id)
NEW_CLUSTER=$(cd infra/eks/dev/2-cluster && terraform output -raw cluster_security_group_id)
# overlays/dev/{backend,fastapi-guide}/kustomization.yaml 의 pods-db·클러스터 SG 두 값 교체
git add infra/k8s/overlays/dev && git commit -m "chore(dev): EKS 재생성 SG id 갱신"
git push origin develop   # dev argocd 는 develop
```

### 4. ArgoCD 앱 등록

```bash
kubectl apply -f infra/k8s/argocd/apps/dev/
kubectl get applications -n argocd            # Synced
kubectl get externalsecret -n drawe-dev       # SecretSynced=True (SSM 실값)
kubectl get pods -n drawe-dev                 # 1/1 Running
```

### 5. newTag

develop 머지 시 CI 가 overlay `newTag` 를 SHA 로 자동 bump(`ci(dev): bump ... [skip ci]`). 수동 필요 시 overlay 의 newTag 를 ECR 태그로.

### 6. 런타임 검증

readiness 200 · OAuth 실로그인 · AuthedImage 이미지 로드 · track/growth 신필드 · ViTPose 무다운로드 기동 · AI_GEN_PROVIDER=gemini(dev) · 가이드 1건 실생성 관통.

## dev 함정 (prod 런북 함정의 dev 각주)

### D1. Karpenter 가 SGP 워크로드를 t4g 에 배치 → pod-eni 미부착 → RDS 불통

**증상**: backend `Communications link failure`(MySQL). RDS 는 available.
**원인**: dev Karpenter 는 비용상 t4g 허용. SGP(SecurityGroupPolicy) 워크로드(backend·fastapi-guide)가 t4g(버스터블)에 뜨면 ENI trunking 미지원 → branch ENI(pod-eni) 안 붙음 → 노드 SG 통신 → RDS ingress 없음. nitro(m6g)에 떠도 SGP 생성 이전 스케줄이면 pod-eni 없음.
**해결(코드 영구 반영)**: `infra/k8s/base/{backend,fastapi-guide}/deployment.yaml` 에 nodeAffinity `karpenter.k8s.aws/instance-category In [m,c,r]`. 시스템NG(라벨 없음)·t4g 자동 배제. **base 배치**(SGP 자체가 base, 환경 무관 진실; prod 는 Karpenter 가 이미 m/c/r 만이라 무해). fastapi-embed(비-SGP)는 제약 없이 t4g 유지(비용).
**확인**: `kubectl get pod <backend> -o jsonpath="{.metadata.annotations.vpc\.amazonaws\.com/pod-eni}"` → 값 있어야 정상.

### D2. db_password 변수 누락 → RDS 암호 회전

`prod_eks_cutover.md` 함정 11 과 동일 — terraform-dev 도 `random_password.db` 구조 동일. apply 전 `TF_VAR_db_password`(SSM `/drawe/dev/db-password` 실값) 주입, plan 에 `random_password.db`·`aws_db_instance.main` password change 보이면 중단.

## Teardown 순서 (역방향)

★**끄기 전 확인: 진행 중인 검증·데모가 없는지.** (성장 그래프 데모용 project 32 등 — `docs/cleanup-manifest.md` 참조.)

```bash
# 1) 워크로드/EKS 정리
kubectl delete -f infra/k8s/argocd/apps/dev/          # 앱 내림 (또는 노드그룹 scale-down)
cd infra/eks/dev/3-platform && terraform destroy       # 플랫폼
cd ../2-cluster && terraform destroy                    # 클러스터 (terraform-dev 는 안 건드림)
# 2) 공유 인프라 OFF (bring-up 역순)
aws ec2 stop-instances --instance-ids <drawe-dev-valkey>
aws ec2 stop-instances --instance-ids <drawe-dev-nat>
# (RDS 도 필요시 stop-db-instance)
```

**순서 이유**: Valkey/NAT 를 먼저 끄면 클러스터 정리 중 이미지 pull·API 호출이 막힐 수 있으니 **EKS 정리 → Valkey stop → NAT stop**. bring-up(NAT·Valkey 먼저) 의 정확한 역순.
