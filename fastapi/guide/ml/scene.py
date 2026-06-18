import numpy as np
from guide.ml.embed import embedder

LABELS = {
    # 신체 부위(손/발/얼굴)를 별도 라벨로 둬, 클로즈업 스케치가 '인물 없음'→풍경으로
    # 흘러 포즈/해부 축이 게이팅 아웃되던 문제를 막는다. figure = 인물+부위 합산 신호.
    "subject": [
        "a person or full figure",
        "a hand, foot, arm, or leg",
        "a face or head",
        "a landscape or outdoor scene",
        "a still life or inanimate object",
    ],
    "type": ["a photo or screenshot or document", "an artwork or drawing"],
    "camera": ["low angle view", "high angle view", "eye level"],
    "lighting": ["dramatic lighting", "flat even lighting"],
}

# 인물 도메인(전신 + 신체부위 + 얼굴) — 이들 합이 곧 'figure' prominence.
_FIGURE_SUBJECTS = (
    "a person or full figure",
    "a hand, foot, arm, or leg",
    "a face or head",
)


def _scores(img_vec, labels):
    sims = [float(np.dot(img_vec, embedder.text(lbl))) for lbl in labels]
    e = np.exp(sims - np.max(sims))
    p = e / e.sum()  # softmax → confidence
    return dict(zip(labels, p.tolist()))


def analyze(pil) -> dict:
    iv = embedder.image(pil)
    subj = _scores(iv, LABELS["subject"])
    typ = _scores(iv, LABELS["type"])
    person_p = subj["a person or full figure"]
    figure_p = float(sum(subj[lbl] for lbl in _FIGURE_SUBJECTS))  # 인물+부위+얼굴
    body_part_p = float(subj["a hand, foot, arm, or leg"])
    analyzable = typ["an artwork or drawing"] > 0.5
    return {
        "analyzable": analyzable,
        "global": {"confidence": max(typ.values())},
        "subject": {
            # person: 좁은 의미(전신 인물) — 기존 소비처 호환 유지.
            "person": {"present": person_p > 0.5, "prominence": person_p},
            # figure: 인물+신체부위(손/발/얼굴) — 클로즈업 스케치까지 figure 도메인으로 잡는다.
            #   track 자동선택(resolve_profile)·persona(router.resolve)가 이 신호를 쓴다.
            "figure": {
                "present": figure_p > 0.5,
                "prominence": figure_p,
                "body_part": body_part_p,  # 손/발 등 부위 단독 클로즈업 힌트(diagnose가 손 후보화에 사용)
            },
        },
        "framing": {"camera": _scores(iv, LABELS["camera"])},  # 낮은 신뢰도 힌트
        "render": {"lighting": _scores(iv, LABELS["lighting"])},  # hard 분기 금지
    }
