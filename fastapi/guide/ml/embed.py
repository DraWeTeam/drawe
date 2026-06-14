"""ml/embed.py — CLIP 임베더(지연 로드판). 모델은 EMBEDDING_MODEL(env)로 결정.

guide 서비스용: 모델을 *import 시점이 아니라 첫 사용 시* 로드한다.
→ routes/app import 가 막히지 않고, lifespan 백그라운드 warmup 에서 비로소 로드 →
  /health 가 loading(503)→ok(200) 로 관측되고 spot 콜드 방어가 의도대로 동작.
공개 API(image/text/dim/model_id)는 artref 원본과 동일.
"""
import open_clip, torch, numpy as np
from guide.config import settings

_DEFAULT = ("ViT-L-14", "openai")  # Spring(clip-vit-large-patch14, 768)과 같은 가중치


def _parse_model_id(model_id: str):
    """'open_clip:<arch>:<pretrained>' → (arch, pretrained). 'open_clip:' 접두는 선택."""
    if not model_id:
        return _DEFAULT
    parts = [p.strip() for p in model_id.split(":")]
    if parts and parts[0].lower() in ("open_clip", "openclip"):
        parts = parts[1:]
    if len(parts) >= 2 and parts[0] and parts[1]:
        return parts[0], parts[1]
    return _DEFAULT


class Embedder:
    def __init__(self):
        # 문자열만 — 모델 로드 없음(import 비용 0).
        self.model_id = settings.embedding_model or "open_clip:ViT-L-14:openai"
        self.model = None
        self.preprocess = None
        self.tokenizer = None
        self._dim = None

    def _ensure(self):
        if self.model is not None:
            return
        arch, pretrained = _parse_model_id(self.model_id)
        # openai 가중치는 QuickGELU로 학습됨 → 활성함수 강제(불일치 시 cos 붕괴).
        # Spring(HF clip-vit-large-patch14 = QuickGELU)과 동일 임베딩 공간 유지에도 필수.
        force_qg = (pretrained or "").lower() == "openai"
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            arch, pretrained=pretrained, force_quick_gelu=force_qg)
        self.tokenizer = open_clip.get_tokenizer(arch)
        self.model.eval()

    @property
    def dim(self) -> int:
        # 실제 임베딩 차원(모델이 결정). 컬렉션 size·검증에 사용 — 첫 접근 시 로드.
        if self._dim is None:
            self._dim = int(self.text("dimension probe").shape[0])
        return self._dim

    @torch.no_grad()
    def image(self, pil) -> np.ndarray:
        self._ensure()
        x = self.preprocess(pil).unsqueeze(0)
        v = self.model.encode_image(x)
        return torch.nn.functional.normalize(v, dim=-1)[0].cpu().numpy()

    @torch.no_grad()
    def text(self, s: str) -> np.ndarray:
        self._ensure()
        v = self.model.encode_text(self.tokenizer([s]))
        return torch.nn.functional.normalize(v, dim=-1)[0].cpu().numpy()


embedder = Embedder()
