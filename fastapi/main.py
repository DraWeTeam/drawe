import io
import logging
import os

from opentelemetry.instrumentation.logging import LoggingInstrumentor

# opentelemetry-instrument 가 startup 에 LoggingInstrumentor 를 이미 instrument 하므로
# (중복 instrument 는 no-op) set_logging_format 인자만으론 포맷이 안 먹는다(실측). LogRecordFactory
# 로 otelTraceID/otelSpanID 는 이미 주입되니, root 로깅 포맷만 force 로 덮어써 trace context 를
# 출력한다. uvicorn 은 root 핸들러를 재구성하지 않아 앱 로그(propagate)에 반영된다.
LoggingInstrumentor().instrument()
logging.basicConfig(format=os.environ.get("OTEL_PYTHON_LOG_FORMAT"), force=True)

from dotenv import load_dotenv  # noqa: E402
from fastapi import FastAPI, File, HTTPException, UploadFile  # noqa: E402
from PIL import Image, UnidentifiedImageError  # noqa: E402
from pydantic import BaseModel  # noqa: E402
import torch  # noqa: E402
from transformers import CLIPProcessor, CLIPModel  # noqa: E402

logger = logging.getLogger("drawe-fastapi")

# 환경변수 로드
load_dotenv()

# 환경변수 읽기 (기본값 제공)
MODEL_NAME = os.getenv("CLIP_MODEL_NAME", "openai/clip-vit-large-patch14")
DEVICE_PREF = os.getenv("DEVICE", "auto")  # auto / cuda / cpu

app = FastAPI()

# device 결정
if DEVICE_PREF == "auto":
    device = "cuda" if torch.cuda.is_available() else "cpu"
else:
    device = DEVICE_PREF

print(f"CLIP 모델 로딩 중... model={MODEL_NAME}, device={device}")
print("첫 실행 시 다운로드에 5-10분 소요")

model = CLIPModel.from_pretrained(MODEL_NAME).to(device)
processor = CLIPProcessor.from_pretrained(MODEL_NAME)
model.eval()
print(f"로드 완료. device: {device}")


MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10MB


class TextEmbedRequest(BaseModel):
    text: str


class TextEmbedResponse(BaseModel):
    embedding: list[float]
    dimension: int


class ImageEmbedResponse(BaseModel):
    embedding: list[float]
    dimension: int


@app.get("/health")
def health():
    return {"status": "ok", "device": device, "model": MODEL_NAME}


@app.post("/embed/text", response_model=TextEmbedResponse)
def embed_text(req: TextEmbedRequest):
    inputs = processor(
        text=[req.text], return_tensors="pt", padding=True, truncation=True
    ).to(device)

    with torch.no_grad():
        text_features = model.get_text_features(
            input_ids=inputs["input_ids"], attention_mask=inputs["attention_mask"]
        )

        if hasattr(text_features, "pooler_output"):
            text_features = text_features.pooler_output
        elif hasattr(text_features, "last_hidden_state"):
            text_features = text_features.last_hidden_state[:, 0, :]

        text_features = text_features / text_features.norm(dim=-1, keepdim=True)

    embedding = text_features[0].cpu().tolist()
    return TextEmbedResponse(embedding=embedding, dimension=len(embedding))


@app.post("/embed/image", response_model=ImageEmbedResponse)
async def embed_image(image: UploadFile = File(...)):
    content_type = (image.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {image.content_type!r}. Expected image/*.",
        )

    raw = await image.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty image payload.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large: {len(raw)} bytes (max {MAX_IMAGE_BYTES}).",
        )

    logger.info(
        "embed_image: received %d bytes, content_type=%s", len(raw), content_type
    )

    try:
        pil_image = Image.open(io.BytesIO(raw))
        pil_image.load()
        pil_image = pil_image.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid image") from exc

    inputs = processor(images=pil_image, return_tensors="pt").to(device)

    with torch.no_grad():
        image_features = model.get_image_features(pixel_values=inputs["pixel_values"])

        if hasattr(image_features, "pooler_output"):
            image_features = image_features.pooler_output
        elif hasattr(image_features, "last_hidden_state"):
            image_features = image_features.last_hidden_state[:, 0, :]

        image_features = image_features / image_features.norm(dim=-1, keepdim=True)

    embedding = image_features[0].cpu().tolist()
    logger.info("embed_image: returning embedding of dimension %d", len(embedding))
    return ImageEmbedResponse(embedding=embedding, dimension=len(embedding))
