import numpy as np
from guide.ml.embed import embedder

LABELS = {
    "subject": ["a person", "no person, landscape or still life"],
    "type": ["a photo or screenshot or document", "an artwork or drawing"],
    "camera": ["low angle view", "high angle view", "eye level"],
    "lighting": ["dramatic lighting", "flat even lighting"],
}


def _logit_scale() -> float:
    """CLIP 학습 시의 logit_scale(=temperature 역수). 이게 빠지면 cos(~0.2) 두 개의
    softmax 가 항상 ≈0.5 로 붕괴해 prominence/confidence 가 신호를 잃는다(실측: 20장 전부
    prom 0.48~0.52). openai ViT-L-14 는 exp(logit_scale)≈100. 모델 미로드 시 표준값 폴백."""
    m = getattr(embedder, "model", None)
    ls = getattr(m, "logit_scale", None)
    if ls is None:
        return 100.0
    try:
        return float(ls.exp().clamp(max=100).item())
    except Exception:
        return 100.0


def _scores(img_vec, labels):
    scale = (
        _logit_scale()
    )  # 누락 시 softmax 평탄화 버그 → 반드시 cos 에 곱한 뒤 softmax
    sims = [float(np.dot(img_vec, embedder.text(lbl))) * scale for lbl in labels]
    e = np.exp(sims - np.max(sims))
    p = e / e.sum()  # softmax → confidence
    return dict(zip(labels, p.tolist()))


def _has_content(pil) -> bool:
    """그릴 게 실제로 있나(빈 캔버스 판별). CLIP은 백지도 약하게 '그림'(art_p≈0.61)이라 불러
    analyzable 을 통과시킨다 → 결정적 마크통계로 보강한다. 백지=윤곽선 0·중간톤≈0(실측 edge=0.000
    mid=0.001), 가장 옅은 선화도 edge≥0.007. OR 게이트(둘 다 0 근처라야 '빈'으로 판정) →
    옅은 실제 그림의 오탐(=과도한 abstain)을 최소화한다. mid 정의는 sketch_features 와 동일."""
    try:
        import cv2

        a = np.asarray(pil.convert("L"))  # 0..255 uint8
        g = a.astype(float) / 255.0
        mid = float(((g > 0.2) & (g < 0.8)).mean())  # 중간톤 비율
        edge = float((cv2.Canny(a, 80, 160) > 0).mean())  # 윤곽선 픽셀 비율
        return edge >= 0.004 or mid >= 0.008
    except Exception:
        return True  # 측정 실패 시 분석을 막지 않는다(보수적으로 통과)


def analyze(pil) -> dict:
    iv = embedder.image(pil)
    subj = _scores(iv, LABELS["subject"])
    typ = _scores(iv, LABELS["type"])
    person_p = subj["a person"]
    # analyzable = 'CLIP이 그림이라고 봄' AND '실제 마크가 있음'. 백지는 art_p>0.5 를 통과하지만
    #   마크가 없어 여기서 걸린다 → triage 가 not_drawing→clarify 로 보낸다(기존 게이트 재사용).
    analyzable = typ["an artwork or drawing"] > 0.5 and _has_content(pil)
    return {
        "analyzable": analyzable,
        "global": {"confidence": max(typ.values())},
        "subject": {"person": {"present": person_p > 0.5, "prominence": person_p}},
        "framing": {"camera": _scores(iv, LABELS["camera"])},  # 낮은 신뢰도 힌트
        "render": {"lighting": _scores(iv, LABELS["lighting"])},  # hard 분기 금지
    }
