# 1단계 — 2-cluster (dev)

EKS 컨트롤플레인 + IRSA용 OIDC + core 애드온(vpc-cni·coredns·kube-proxy·ebs-csi) + arm64 system 노드그룹을 만드는 레이어입니다. (계획서 Layer 2)

- **vpc-cni**: Prefix Delegation + WARM 설정 포함 (계획서 §5-A) — `/24` 서브넷 IP 고갈 예방
- **system 노드그룹**: ALB Controller·ESO·Karpenter·ArgoCD 같은 플랫폼 pod가 상주할 자리. Karpenter가 자기 자신을 띄울 노드 문제(chicken-egg) 해소
- **OIDC provider**: 3-platform의 IRSA가 사용

## 전제

- 0단계(outputs 브리지)가 `terraform apply` 되어 ECS state에 `vpc_id/subnet_ids`가 노출돼 있어야 함 (이 레이어가 remote_state로 읽음).
- dev 계정(570515227314) 자격증명.

## 배치 위치

```
infra/
├── terraform-dev/                 # (0단계 브리지 적용된 ECS 스택)
├── modules/eks-cluster/           # ← 이 레이어 모듈
└── eks/dev/2-cluster/             # ← 이 레이어 caller
```

## 실행

```bash
cd infra/eks/dev/2-cluster
terraform init
terraform plan      # 클러스터/노드그룹/애드온/OIDC 생성 계획 확인
terraform apply     # 약 10~15분 (컨트롤플레인 + 노드 기동)
```

## "잘 됐다" 확인

```bash
aws eks update-kubeconfig --name drawe-dev --region ap-northeast-2

kubectl get nodes -o wide
#  성공: system 노드 2개 Ready, ARCH=arm64, OS-IMAGE=Amazon Linux 2023

kubectl get pods -n kube-system
#  성공: aws-node(vpc-cni)/coredns/kube-proxy/ebs-csi Running

# Prefix Delegation 적용 확인
kubectl set env ds/aws-node -n kube-system --list | grep -i prefix
#  또는
aws eks describe-addon --cluster-name drawe-dev --addon-name vpc-cni \
  --query 'addon.configurationValues' --output text
#  성공: ENABLE_PREFIX_DELEGATION=true, WARM_PREFIX_TARGET=1 보임
```

`kubectl get nodes`에서 arm64 노드 2개가 Ready면 1단계 완료입니다.

## 다음 레이어에 넘기는 outputs

이 레이어의 `outputs.tf`가 노출하는 값을 3-platform이 remote_state로 읽습니다:
`cluster_name`, `oidc_provider_arn`, `oidc_provider_url`, `node_security_group_id` (+ endpoint/ca/cluster_sg).

## 비용 참고 (dev)

- 컨트롤플레인 고정비 ~$73/월 (끌 수 없음, 계획서 §9)
- system 노드그룹 t4g.large × 2 (on-demand). 비용 줄이려면 `system_*_size`를 1로 낮추거나, 비운영 시간에 `terraform destroy`(공유 인프라는 ECS state에 남아 안전).

## prod 차이

`eks/prod/2-cluster`로 동일 복제: state key `eks/prod/cluster`, prod 계정, `warm_prefix_target="2"`/`warm_ip_target="10"`, system NG 사이즈 ↑.
