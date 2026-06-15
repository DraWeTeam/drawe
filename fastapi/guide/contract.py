"""guide/contract.py — 응답 경계(boundary). 내부 GuideResponse → 팀 계약 dict.

계약과 스키마가 동일하므로 매핑은 사실상 항등이며, 여기서 보장하는 것:
 1) growth(§4) 슬롯을 응답에 주입(값은 routes 가 계산해 넘김; P2-b 부터).
 2) 불변식 모니터 — 직렬화 문자열에 내부단계(_stage)·평가어가 새지 않았는지 최종 스캔.
    상위 가드(safety/validate.py)가 이미 차단하지만, 모든 응답이 지나는 *한 지점*에서 재확인(로그, 비치명).
"""
import re
import logging

log = logging.getLogger("drawe-fastapi.guide")

from guide.schemas import Growth, GrowthChips, RecurringStat, TrendPoint

# 내부 성장 단계 토큰(절대 비노출) — growth_stage.py 불변식
_STAGE = re.compile(r"\b(foundation|developing|refining)\b|_stage")
try:
    from guide.safety.validate import FORBIDDEN as _FORBIDDEN   # 평가어 가드와 동일 패턴
except Exception:
    _FORBIDDEN = re.compile(r"(초보|실력|등급|점수|재능 ?없|잘 그렸|못 그렸|대신 그려|정답 ?이미지)")


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
    data["growth"] = growth_obj.model_dump() if hasattr(growth_obj, "model_dump") else growth_obj
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
    recurring = raw.get("recurring", []) or []
    improved = raw.get("improved", []) or []
    current = raw.get("current_focus")

    tpoints = [TrendPoint(index=i + 1, label=str(i + 1),
                          difficulty_count=int((p or {}).get("flagged_count", 0)))
               for i, p in enumerate(timeline)]

    rstat = None
    if recurring:
        top = max(recurring, key=lambda sp: flag_count.get(sp, 0))
        hits = int(flag_count.get(top, 0))
        if hits > 0 and window > 0:
            rstat = RecurringStat(sub_problem=top, window=window, hits=hits,
                                  ratio=round(hits / window, 2))

    delta = None
    if len(timeline) >= 2:
        first = int((timeline[0] or {}).get("flagged_count", 0))
        last = int((timeline[-1] or {}).get("flagged_count", 0))
        if first > last:
            delta = f"최근 {len(timeline)}장에서 함께 짚인 어려움이 {first}개에서 {last}개로 줄었어요."
        elif last > first:
            delta = f"최근 {len(timeline)}장에서 함께 짚인 어려움이 {first}개에서 {last}개로 늘었어요."

    chips = GrowthChips(
        current_stage_axes=list(dict.fromkeys(([current] if current else []) + list(recurring))),
        improving_axes=list(improved),
    )

    narration = (note or "").strip()
    if not narration:
        bits = []
        if rstat:
            bits.append(f"최근 {window}장 중 한 가지 어려움이 {rstat.hits}번 보였어요.")
        if delta:
            bits.append(delta)
        narration = " ".join(bits).strip()

    g = Growth(narration=narration, recurring_stat=rstat, trend=tpoints,
               delta_note=delta, chips=chips)
    # 자료가 사실상 없으면 None(프론트가 섹션 숨기기 쉽게)
    if (not tpoints and rstat is None
            and not chips.current_stage_axes and not chips.improving_axes and not narration):
        return None
    return g
