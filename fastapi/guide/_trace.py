"""컨텍스트 보존 추적기(관측 전용, 동작 불변).

파이프라인 경계마다 '값'이 아니라 '몇 개 들어와 몇 개 나갔나'(cardinality/coverage)를
한 줄로 찍는다. 의도: scene → diagnose(sig/hits/ranked) → prompt → llm 각 경계에서
정보가 어디서 얼마나 줄어드는지를 한 요청 로그만 보고 객관적으로 짚는다.

켜기:  TRACE_CTX=1  (기본 꺼짐 → 운영 로그 오염 없음)
보기:  docker compose logs api | grep '\\[trace:'
"""

import logging
import os

log = logging.getLogger("drawe-fastapi.guide._trace")


def _on() -> bool:
    return os.environ.get("TRACE_CTX", "0") == "1"


def trace(stage: str, /, **fields) -> None:
    """한 줄 = 한 경계. 컬렉션은 len과 상위 표본만(로그 폭주 방지). flush로 즉시 가시화.

    stage 는 positional-only(`/`) — 그래야 fields 에 'stage' 같은 이름을 넘겨도
    첫 인자와 충돌하지 않는다(예: trace("x", stage="fn_start") → [trace:x] stage=fn_start).
    이 충돌이 _vlm_hand_signal 의 hand.vlm.enter 트레이스를 TypeError 로 죽여 /guide 가
    500 으로 떨어지던 버그의 원인이었다(관측기가 동작을 깨면 안 된다는 불변식 복구)."""
    if not _on():
        return
    parts = []
    for k, v in fields.items():
        if isinstance(v, dict):
            parts.append(f"{k}={len(v)}:{sorted(v)[:6]}")
        elif isinstance(v, (list, set, tuple)):
            try:
                sample = sorted(v)[:6]
            except TypeError:
                sample = list(v)[:6]
            parts.append(f"{k}={len(v)}:{sample}")
        else:
            parts.append(f"{k}={v}")
    log.info(f"[trace:{stage}] " + " ".join(parts))
