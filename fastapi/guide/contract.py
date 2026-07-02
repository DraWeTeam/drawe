"""guide/contract.py — 응답 경계(boundary). 내부 GuideResponse → 팀 계약 dict.

계약과 스키마가 동일하므로 매핑은 사실상 항등이며, 여기서 보장하는 것:
 1) growth(§4) 슬롯을 응답에 주입(값은 routes 가 계산해 넘김; P2-b 부터).
 2) 불변식 모니터 — 직렬화 문자열에 내부단계(_stage)·평가어가 새지 않았는지 최종 스캔.
    상위 가드(safety/validate.py)가 이미 차단하지만, 모든 응답이 지나는 *한 지점*에서 재확인(로그, 비치명).
"""

import os
import re
import logging

from guide._trace import trace
from guide.schemas import Growth, GrowthChips, RecurringStat, TrendPoint

log = logging.getLogger("drawe-fastapi.guide")

# ── backward-growth 임계(over-fire 방지) ──────────────────────────────────────────
# 과거 대비 서술(추세곡선·delta·재발·개선 chip)은 표본이 충분할 때만 낸다. 2 데이터포인트는
# 추세가 아니라 노이즈다(1→3이면 "200%"라는 무의미한 값 → phantom growth).
#   MIN_TREND: 추세차트·recurring·improving 최소 업로드 수. MIN_DELTA: '처음 대비' 역사 서술 최소.
# ★골든fit 아님 — "2점은 추세 아님"이라는 통계 하한 + RECENT_N(5) 창 정합. 실사용 practice_log
#   분포가 쌓이면 재튠(그래서 growth.gate 계측을 남긴다). forward(현재 집중 chip·next-step)는 항상 유지.
_GROWTH_MIN_TREND = int(os.environ.get("GROWTH_MIN_TREND", "3"))
_GROWTH_MIN_DELTA = int(os.environ.get("GROWTH_MIN_DELTA", "5"))

# ── chip 나열 상한(over-fire: 나열도 과다노출) ──────────────────────────────────────
# 현재단계·개선 칩을 상위 N개로 절단(이력 쌓여도 우르르 나열 방지). current_focus 는 선두 고정,
# 나머지(recurring/improved)는 재발빈도(flag_count) 높은 순 → 동점은 id 순(결정론, 매 호출 동일).
#   표시층 전용(축 판정·predict_axis 무관). 시안 정합용 상수 — env 로 재튠 가능.
_MAX_STAGE_CHIPS = int(os.environ.get("MAX_STAGE_CHIPS", "3"))
_MAX_IMPROVING_CHIPS = int(os.environ.get("MAX_IMPROVING_CHIPS", "2"))

# 내부 성장 단계 토큰(절대 비노출) — growth_stage.py 불변식
_STAGE = re.compile(r"\b(foundation|developing|refining)\b|_stage")
try:
    from guide.safety.validate import FORBIDDEN as _FORBIDDEN  # 평가어 가드와 동일 패턴
except Exception:
    _FORBIDDEN = re.compile(
        r"(초보|실력|등급|점수|재능 ?없|잘 그렸|못 그렸|대신 그려|정답 ?이미지)"
    )


def _scan(obj, path="$"):
    hits = []
    if isinstance(obj, str):
        if _STAGE.search(obj):
            hits.append(("stage", path))
        if _FORBIDDEN.search(obj):
            hits.append(("forbidden", path))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            hits += _scan(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            hits += _scan(v, f"{path}[{i}]")
    return hits


def finalize_guide_response(resp, growth_obj=None) -> dict:
    """coach GuideResponse → 계약 dict.
    growth_obj: schemas.Growth | None — P2-b 에서 routes 가 계산해 주입(현재는 None).
    """
    data = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
    data["growth"] = (
        growth_obj.model_dump() if hasattr(growth_obj, "model_dump") else growth_obj
    )
    leaks = _scan(data)
    if leaks:
        log.warning("contract boundary leak (non-fatal): %s", leaks[:5])
    return data


def growth_from_raw(raw, note=None):
    """roadmap.growth_view(raw dict) → schemas.Growth | None (§4).
    측정=사실(약점 '개수' 변화)로만 서술. _stage·평가어 비노출(경계 모니터가 재확인).
    축은 id 그대로(블록 sub_problem 처럼; 프론트가 id→라벨 매핑).
    """
    if not raw:
        return None
    window = int(raw.get("window", 5) or 5)
    timeline = raw.get("timeline", []) or []
    flag_count = raw.get("flag_count", {}) or {}
    current = raw.get("current_focus")
    # ★backward-growth 게이트: 최근 창 업로드 수(=이력 표본)로 과거 대비 서술을 억제한다.
    #   forward(current_stage chip·next-step narration)는 무관하게 항상 유지.
    n_uploads = len(timeline)
    show_trend = n_uploads >= _GROWTH_MIN_TREND
    show_delta = n_uploads >= _GROWTH_MIN_DELTA
    trace(  # 계측: 실사용 업로드 수 분포 → N 재튠 근거(shadow 계열, 동작 불변)
        "growth.gate", n_uploads=n_uploads, show_trend=show_trend, show_delta=show_delta
    )
    recurring = (raw.get("recurring", []) or []) if show_trend else []
    improved = (raw.get("improved", []) or []) if show_trend else []

    tpoints = (
        [
            TrendPoint(
                index=i + 1,
                label=str(i + 1),
                difficulty_count=int((p or {}).get("flagged_count", 0)),
            )
            for i, p in enumerate(timeline)
        ]
        if show_trend
        else []
    )

    rstat = None
    if recurring:
        top = max(recurring, key=lambda sp: flag_count.get(sp, 0))
        hits = int(flag_count.get(top, 0))
        if hits > 0 and window > 0:
            rstat = RecurringStat(
                sub_problem=top, window=window, hits=hits, ratio=round(hits / window, 2)
            )

    delta = None
    if show_delta and len(timeline) >= 2:
        first = int((timeline[0] or {}).get("flagged_count", 0))
        last = int((timeline[-1] or {}).get("flagged_count", 0))
        if first > last:
            delta = f"최근 {len(timeline)}장에서 함께 짚인 어려움이 {first}개에서 {last}개로 줄었어요."
        elif last > first:
            delta = f"최근 {len(timeline)}장에서 함께 짚인 어려움이 {first}개에서 {last}개로 늘었어요."

    # 나열 상한(over-fire): current_focus 선두 고정 + recurring 을 flag_count 우선 상위로 채워 최대 N.
    #   improved 도 flag_count 우선 상위 M. 동점은 id 순 → 매 호출 동일 결과(비결정 금지).
    def _rank(axes):
        return sorted(axes, key=lambda sp: (-int(flag_count.get(sp, 0)), sp))

    stage_axes = ([current] if current else []) + _rank(
        [sp for sp in recurring if sp != current]
    )
    chips = GrowthChips(
        current_stage_axes=list(dict.fromkeys(stage_axes))[:_MAX_STAGE_CHIPS],
        improving_axes=_rank(list(improved))[:_MAX_IMPROVING_CHIPS],
    )

    narration = (note or "").strip()
    if not narration:
        bits = []
        if rstat:
            bits.append(f"최근 {window}장 중 한 가지 어려움이 {rstat.hits}번 보였어요.")
        if delta:
            bits.append(delta)
        narration = " ".join(bits).strip()

    g = Growth(
        narration=narration,
        recurring_stat=rstat,
        trend=tpoints,
        delta_note=delta,
        chips=chips,
    )
    # 자료가 사실상 없으면 None(프론트가 섹션 숨기기 쉽게)
    if (
        not tpoints
        and rstat is None
        and not chips.current_stage_axes
        and not chips.improving_axes
        and not narration
    ):
        return None
    return g
