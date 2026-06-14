"""guide/warmup.py — 콜드 방어 워밍업. lifespan(startup)에서 1회.
이게 끝나야(ready) /health 가 200. (P1: 포팅된 OpenCLIP 임베더 사용)
"""
import os
import logging

log = logging.getLogger("drawe-fastapi.guide")


def warmup_guide():
    from PIL import Image
    from guide.ml.embed import embedder        # artref OpenCLIP ViT-L/14
    dummy = Image.new("RGB", (64, 64), (127, 127, 127))
    embedder.image(dummy)
    embedder.text("warmup")

    # (게이트) 손 관찰 — mediapipe/VLM 은 첫 사용 시 지연 로드. 켜졌을 때만 가볍게 덥힌다.
    if os.getenv("HAND_VLM", "0") == "1" or os.getenv("HAND_AUTO", "0") == "1":
        try:
            import guide.ml.pose  # noqa: F401  (mediapipe 는 extract 내부에서 지연 import)
        except Exception as e:
            log.warning("hand warmup skipped: %s", e)

    log.info("guide warmup done")
