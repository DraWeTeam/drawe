# fastapi

CLIP 기반 텍스트/이미지 임베딩 서버입니다. 모노레포 `fastapi/` 디렉터리에 위치하며, 배포는 경로 필터(`fastapi/**`) 기반 `fastapi-cd` 워크플로가 담당합니다.

## 역할

- Drawe 백엔드([`backend`](../backend/README.md))의 임베딩 요청을 처리합니다.
- CLIP ViT-Large/14 모델로 텍스트/이미지를 768차원 벡터로 변환합니다.
- 결과 벡터는 Pinecone에 저장되거나 검색에 사용됩니다.

## 스택

- FastAPI + uvicorn
- PyTorch + transformers
- CLIP (`openai/clip-vit-large-patch14`)

## 실행 방법

### 권장: docker-compose 스택으로 함께 기동

전체 백엔드 스택(MySQL · Valkey · backend · fastapi)을 함께 띄우려면 [`infra`](../infra/README.md) 의 로컬 compose 를 사용하세요.

```bash
cd ../infra
docker compose -f docker-compose.local.yml up -d   # fastapi → http://localhost:8000
```

### 단독 실행

#### 1. 가상 환경 생성·활성화

```bash
python -m venv venv

# Windows
.\venv\Scripts\activate
# Mac/Linux
source venv/bin/activate
```

#### 2. 의존성 설치

```bash
pip install -r requirements.txt
```

#### 3. 환경변수 설정

```bash
cp .env.example .env
```

#### 4. 서버 실행

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

## API

### POST `/embed/text`

텍스트를 768차원 벡터로 변환합니다.

**Request**
```json
{
  "text": "cherry blossoms spring"
}
```

**Response**
```json
{
  "vector": [0.123, -0.456, ...]
}
```

### POST `/embed/image`

이미지를 768차원 벡터로 변환합니다.

### POST `/batch/load`

데이터 일괄 적재용 엔드포인트입니다 (1,000개 단위).

## 의존 시스템

- **호출자**: backend (Spring Boot)
- **모델**: HuggingFace CLIP (`openai/clip-vit-large-patch14`)
- **벡터 저장소**: Pinecone

## 배포

- **타깃**: AWS ECS (EC2, Graviton ARM64) — 이미지는 ARM64 빌드 필요
- **흐름**: 이미지 빌드 → ECR push → ECS 업데이트
- 환경(dev/prod) 차이는 [`infra/README.md`](../infra/README.md) 참고

## 관련 문서

- [루트 README](../README.md) — 전체 아키텍처
- [`backend/README.md`](../backend/README.md) — 호출자
- [`frontend/README.md`](../frontend/README.md) — 사용자 UI