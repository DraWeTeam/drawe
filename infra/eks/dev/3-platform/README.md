# 2단계 — 3-platform (dev)

Kubernetes 운영 기반을 설치하는 레이어입니다. (계획서 Layer 3)

- **AWS Load Balancer Controller** — Ingress(class=alb) → ALB 자동 관리
- **External Secrets Operator** + `ClusterSecretStore(aws-ssm)` — SSM `/drawe/dev/*` → K8s Secret
- **Karpenter** — 워크로드 노드 오토프로비저닝 (arm64 + Spot, interruption queue)
- **Security Groups for Pods** — RDS/캐시 접근용 pod 전용 SG (계획서 §5-C A안)
- **ArgoCD** — 설치(부트스트랩)까지. root app 은 이번 단계엔 **끔**(아래)

## 전제 (이미 충족됨)

- 0단계 브리지 + 1단계 2-cluster 가 apply 되어 있어야 함. (state: `dev/terraform.tfstate`, `eks/dev/cluster/terraform.tfstate`)
- 2-cluster outputs(`cluster_name`/`oidc_provider_arn`/`oidc_provider_url`/`node_security_group_id`)를 remote_state 로 읽음.
- 노드 2개 Ready (헬름 pod 가 스케줄될 자리).

## 이번 단계의 ArgoCD 동작 (중요)

`enable_argocd_root_app = false`(기본)라 **ArgoCD 는 설치만** 되고 앱 동기화는 안 합니다.
아직 `k8s/overlays/dev` 매니페스트가 없기 때문입니다. 나중 **5-apps 단계**에서 매니페스트를
올린 뒤 `terraform.tfvars` 에 `gitops_repo_url` 채우고 `enable_argocd_root_app = true` 로
다시 apply 하면 그때부터 ArgoCD 가 GitOps 동기화를 시작합니다.

## apply 전 필수 작업 1가지

ALB Controller 공식 IAM 정책(약 340줄)을 placeholder 와 교체:

```bash
curl -o ../../../modules/eks-platform/policies/alb-controller-iam-policy.json \
  https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.17.1/docs/install/iam_policy.json
```

(차트 버전은 `modules/eks-platform/variables.tf` 의 기본값. 최신 호환 버전인지 한 번 확인 권장.)

## 실행

```bash
cd eks/dev/3-platform
terraform init
terraform plan
terraform apply
```

## "잘 됐다" 확인

```bash
kubectl get pods -n kube-system | egrep 'load-balancer|karpenter'   # Running
kubectl get pods -n external-secrets                                # Running
kubectl get clustersecretstore aws-ssm                             # STATUS=Valid
kubectl get nodepool,ec2nodeclass                                  # default 존재
kubectl get pods -n argocd                                         # Running (root app 은 아직 없음 = 정상)

# Karpenter 동작 테스트(선택): Pending pod → 새 노드
kubectl create deploy inflate --image=public.ecr.aws/eks-distro/kubernetes/pause:3.9
kubectl scale deploy inflate --replicas=8 && kubectl get nodes -w   # 1~2분 내 노드 증가
kubectl delete deploy inflate
```

## 넘기는 outputs

`pods_db_security_group_id`(앱 SecurityGroupPolicy 가 참조), `cluster_secret_store_name`,
IRSA role ARN 들. caller `rds-access.tf` 가 RDS SG 에 `pod SG → 3306` 인그레스를 추가함.

## prod 차이

`eks/prod/3-platform` 로 복제: state `eks/prod/platform`, prod 계정, Karpenter on-demand base ↑,
ArgoCD HA values, 캐시 6379 인그레스(`rds-access.tf` 주석 해제 + ECS valkey_sg output 추가).
