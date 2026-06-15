import boto3
from botocore.config import Config
from guide.config import settings

# 로컬(MinIO)은 endpoint+key+secret 명시, AWS(ECS)는 비워두면 IAM task role + 리전 기본 엔드포인트.
#   - endpoint_url=None → boto3 가 AWS S3 기본(리전) 엔드포인트 사용
#   - aws_access_key_id/secret=None → 기본 자격증명 체인(ECS task role)으로 폴백
_HAS_KEYS = bool(settings.s3_key and settings.s3_secret)
_ENDPOINT = settings.s3_endpoint or None
_PUBLIC_ENDPOINT = settings.s3_public_endpoint or None


def _client(endpoint, signed_path=False):
    kw = {"endpoint_url": endpoint}
    if _HAS_KEYS:
        kw["aws_access_key_id"] = settings.s3_key
        kw["aws_secret_access_key"] = settings.s3_secret
    if signed_path:
        kw["config"] = Config(signature_version="s3v4", s3={"addressing_style": "path"})
    return boto3.client("s3", **kw)


# 컨테이너 내부 통신용(put/get) — minio:9000 또는 AWS 기본 엔드포인트
s3 = _client(_ENDPOINT)

# presign 전용 — '브라우저가 닿는' 주소로 서명(로컬 localhost:9000 / AWS presigned 도메인)
_presign = _client(_PUBLIC_ENDPOINT, signed_path=True)


def put_image(key: str, data: bytes, content_type: str = "image/png"):
    s3.put_object(
        Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type
    )


def put_svg(key: str, data):
    """구축선 SVG 저장(Phase 4). data 는 str 또는 bytes."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    s3.put_object(
        Bucket=settings.s3_bucket, Key=key, Body=data, ContentType="image/svg+xml"
    )


def get_image(key: str) -> bytes:
    """S3에서 원본 바이트를 다시 읽음(재임베딩/복구 = S3→벡터DB 재색인용)."""
    return s3.get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()


def ensure_bucket():
    """버킷 보장. AWS(ECS)에서는 버킷을 Terraform 이 만들고 task role 에 CreateBucket 권한이
    없으므로, 키가 명시되지 않은(IAM 역할) 환경에서는 head 만 시도하고 생성은 건너뛴다.
    로컬(MinIO, 키 명시)에서만 없으면 생성."""
    try:
        s3.head_bucket(Bucket=settings.s3_bucket)
    except Exception:
        if not _HAS_KEYS:
            # 매니지드 버킷(Terraform) 전제 — 생성 시도 금지(권한 없음). 로그만.
            print(
                f"[s3] head_bucket 실패(매니지드 버킷 전제로 생성 건너뜀): {settings.s3_bucket}"
            )
            return
        s3.create_bucket(Bucket=settings.s3_bucket)


def presigned_url(key: str, expires: int = 3600) -> str:
    """브라우저에서 바로 열람 가능한 임시 GET URL."""
    return _presign.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=expires,
    )
