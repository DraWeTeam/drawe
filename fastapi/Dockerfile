# ── Stage 1: Builder (CPU-only torch + 의존성 + CLIP 가중치) ──
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# requirements.txt 는 GPU 환경(torch==2.11.0)을 가정
# ECS (CPU 환경)에서는 torch==2.5.1 로 대체 설치 (CPU wheel)
RUN pip install --user \
        torch==2.5.1 \
        torchvision==0.20.1 \
        --index-url https://download.pytorch.org/whl/cpu

# requirements.txt 에서 torch / torchvision / nvidia-* 제외하고 설치
COPY requirements.txt .
RUN grep -vE '^(torch==|torchvision==|nvidia-)' requirements.txt > requirements-cpu.txt && \
    pip install --user -r requirements-cpu.txt

# ── 추가: OTel auto-instrumentation 라이브러리 일괄 설치 ──
# 설치된 패키지(fastapi, httpx 등)에 매칭되는 instrumentation 자동 발견
RUN /root/.local/bin/opentelemetry-bootstrap -a requirements > requirements-otel.txt && \
    pip install --user -r requirements-otel.txt

# CLIP 모델 가중치를 이미지에 baking — runtime cold start 시 다운로드 불필요
ENV HF_HOME=/app/.cache/huggingface
RUN python -c "from transformers import CLIPModel, CLIPProcessor; \
    CLIPModel.from_pretrained('openai/clip-vit-large-patch14'); \
    CLIPProcessor.from_pretrained('openai/clip-vit-large-patch14')"


# ── Stage 2: Runtime ──────────────────────────────────
FROM python:3.11-slim

# 비루트 사용자 (1000:1000) 로 실행 — security best practice. backend/Dockerfile 과 동일 정책.
# pip --user 산출물·HF 캐시가 빌더에서 /root 밑에 생기므로, 그대로 두면 비루트 유저가
# 읽지 못한다(/root 는 0700). 따라서 아래에서 유저 홈(/home/drawe)으로 옮기고 소유권을 넘긴다.
RUN groupadd -g 1000 drawe && useradd -u 1000 -g drawe -m drawe

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/home/drawe \
    PYTHONUSERBASE=/home/drawe/.local \
    PATH=/home/drawe/.local/bin:$PATH \
    TRANSFORMERS_CACHE=/app/.cache/huggingface \
    HF_HOME=/app/.cache/huggingface

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# pip --user 패키지: /root/.local → 유저 홈으로 이동 + 소유권 drawe
#  (콘솔 스크립트 shebang 은 시스템 python(/usr/local/bin/python)을 가리키므로 경로 이동에 안전)
COPY --from=builder --chown=drawe:drawe /root/.local /home/drawe/.local
# CLIP 가중치 캐시: 런타임에 transformers 가 lock 등을 쓸 수 있어 drawe 소유로
COPY --from=builder --chown=drawe:drawe /app/.cache /app/.cache

COPY --chown=drawe:drawe main.py ./main.py

EXPOSE 8000

# CLIP 로딩에 30~60초 → start-period 넉넉히
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 비루트로 전환 (이 지점 이후 모든 프로세스는 drawe 권한)
USER drawe:drawe

# OpenTelemetry 자동 계측 활성화.
# opentelemetry-instrument 가 Python 프로세스를 래핑하여
# Trace/Metric/Log 계측을 자동 주입한다.
# OTEL_EXPORTER_OTLP_ENDPOINT 등 OTEL_* 환경변수는
# ECS Task Definition 에서 주입되며 별도 코드 설정 없이 적용된다.
CMD ["opentelemetry-instrument", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1"]