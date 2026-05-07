#!/usr/bin/env bash
# ── 초기 1회 실행: Terraform 상태 저장소 + GitHub OIDC ────
#
# 사전 요구: aws configure 완료, 적절한 IAM 권한
#
# 사용법:
#   chmod +x scripts/init-aws.sh
#   ./scripts/init-aws.sh

set -euo pipefail

AWS_REGION="ap-northeast-2"
PROJECT="drawe"
STATE_BUCKET="${PROJECT}-terraform-state"
LOCK_TABLE="${PROJECT}-terraform-lock"
GITHUB_ORG="YOUR_GITHUB_ORG"   # ← 수정 필요
GITHUB_REPO="YOUR_REPO_NAME"   # ← 수정 필요

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DraWe AWS Initial Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. S3 State Bucket ────────────────────────────────────
echo "▶ Creating S3 bucket for Terraform state..."
if aws s3api head-bucket --bucket "${STATE_BUCKET}" 2>/dev/null; then
  echo "  Bucket already exists."
else
  aws s3api create-bucket \
    --bucket "${STATE_BUCKET}" \
    --region "${AWS_REGION}" \
    --create-bucket-configuration LocationConstraint="${AWS_REGION}"

  aws s3api put-bucket-versioning \
    --bucket "${STATE_BUCKET}" \
    --versioning-configuration Status=Enabled

  aws s3api put-bucket-encryption \
    --bucket "${STATE_BUCKET}" \
    --server-side-encryption-configuration '{
      "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
    }'

  aws s3api put-public-access-block \
    --bucket "${STATE_BUCKET}" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

  echo "  ✅ S3 bucket created: ${STATE_BUCKET}"
fi

# ── 2. DynamoDB Lock Table ────────────────────────────────
echo "▶ Creating DynamoDB table for state locking..."
if aws dynamodb describe-table --table-name "${LOCK_TABLE}" --region "${AWS_REGION}" > /dev/null 2>&1; then
  echo "  Table already exists."
else
  aws dynamodb create-table \
    --table-name "${LOCK_TABLE}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "${AWS_REGION}"

  echo "  ✅ DynamoDB table created: ${LOCK_TABLE}"
fi

# ── 3. GitHub Actions OIDC Provider ──────────────────────
echo "▶ Setting up GitHub Actions OIDC provider..."
OIDC_ARN=$(aws iam list-open-id-connect-providers --query \
  "OpenIDConnectProviderList[?ends_with(Arn, 'token.actions.githubusercontent.com')].Arn" \
  --output text)

if [ -n "${OIDC_ARN}" ]; then
  echo "  OIDC provider already exists: ${OIDC_ARN}"
else
  OIDC_ARN=$(aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
    --query "OpenIDConnectProviderArn" --output text)

  echo "  ✅ OIDC provider created: ${OIDC_ARN}"
fi

# ── 4. GitHub Actions Deploy Role ────────────────────────
ROLE_NAME="${PROJECT}-github-actions-deploy"
echo "▶ Creating IAM role for GitHub Actions..."

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:ref:refs/heads/develop"
      }
    }
  }]
}
EOF
)

if aws iam get-role --role-name "${ROLE_NAME}" > /dev/null 2>&1; then
  echo "  Role already exists."
else
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document "${TRUST_POLICY}"

  # ECR + ECS 배포에 필요한 권한
  aws iam put-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-name "${PROJECT}-deploy-policy" \
    --policy-document '{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Action": [
            "ecr:GetAuthorizationToken",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "ecr:PutImage",
            "ecr:InitiateLayerUpload",
            "ecr:UploadLayerPart",
            "ecr:CompleteLayerUpload"
          ],
          "Resource": "*"
        },
        {
          "Effect": "Allow",
          "Action": [
            "ecs:DescribeTaskDefinition",
            "ecs:RegisterTaskDefinition",
            "ecs:UpdateService",
            "ecs:DescribeServices",
            "ecs:ListTasks",
            "ecs:DescribeTasks"
          ],
          "Resource": "*"
        },
        {
          "Effect": "Allow",
          "Action": "iam:PassRole",
          "Resource": [
            "arn:aws:iam::'"${ACCOUNT_ID}"':role/'"${PROJECT}"'-dev-ecs-exec-role",
            "arn:aws:iam::'"${ACCOUNT_ID}"':role/'"${PROJECT}"'-dev-ecs-task-role"
          ]
        }
      ]
    }'

  ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
  echo "  ✅ Role created: ${ROLE_ARN}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete!"
echo ""
echo "  다음 단계:"
echo "  1. GitHub repo Settings → Secrets → Actions 에 추가:"
echo "     AWS_DEPLOY_ROLE_ARN = arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo ""
echo "  2. Terraform 초기화:"
echo "     cd terraform && terraform init"
echo ""
echo "  3. SSM 시크릿 업데이트:"
echo "     aws ssm put-parameter --name '/${PROJECT}/dev/db-password' \\"
echo "         --value 'REAL_PASSWORD' --type SecureString --overwrite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
