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


def growth_from_raw(raw, note=None, first=False):
    """roadmap.growth_view(raw dict) → schemas.Growth | None (§4).
    측정=사실(약점 '개수' 변화)로만 서술. _stage·평가어 비노출(경계 모니터가 재확인).
    축은 id 그대로(블록 sub_problem 처럼; 프론트가 id→라벨 매핑).
    """
    if not raw:
        return None
    weekly = raw.get("weekly") or {}
    wpoints = (
        weekly.get("points") or []
    )  # ⑦ [{label:'MM.DD', requests:n}] 예전→최근(주)
    axis_weeks = weekly.get("axis_weeks") or {}  # sub_problem -> [(week_key, count)]
    flag_count = raw.get("flag_count", {}) or {}
    current = raw.get("current_focus")
    # ★backward-growth 게이트: ⑦부터 '주'(week) 기준으로 재해석 — 표본이 충분한 '주 수'일 때만
    #   과거 대비 서술(추세곡선·주 N→M·재발)을 낸다. graceful 불변(주<임계면 trend=[] → 차트·% 미발화).
    #   forward(current_stage chip·next-step)는 무관하게 항상 유지.
    n_weeks = len(wpoints)
    show_trend = n_weeks >= _GROWTH_MIN_TREND
    show_delta = n_weeks >= _GROWTH_MIN_DELTA
    trace(  # 계측: 실사용 활동 주 수 분포 → N 재튠 근거(shadow 계열, 동작 불변)
        "growth.gate", n_weeks=n_weeks, show_trend=show_trend, show_delta=show_delta
    )
    recurring = (raw.get("recurring", []) or []) if show_trend else []
    improved = (raw.get("improved", []) or []) if show_trend else []

    # ⑦ 주별 가이드 요청 횟수 곡선(정본 114:15736). label=주 월요일, weekly_count=그 주 요청 수.
    #   difficulty_count 는 하위호환으로 같은 값을 채운다(구 소비처 파괴 방지).
    tpoints = (
        [
            TrendPoint(
                index=i + 1,
                label=str((p or {}).get("label", i + 1)),
                difficulty_count=int((p or {}).get("requests", 0)),
                weekly_count=int((p or {}).get("requests", 0)),
            )
            for i, p in enumerate(wpoints)
        ]
        if show_trend
        else []
    )

    # ⑦ recurring 축의 '주 N→M회' — 초기 활동주 vs 최근 활동주 요청 수(axis_weeks). 프론트가 축 라벨을
    #   붙여 "'{축}' 요청이 주 N회→M회로 줄었어요"를 조립(수치·축 선정은 백엔드 단일 소스).
    rstat = None
    if recurring:
        top = max(recurring, key=lambda sp: flag_count.get(sp, 0))
        aw = axis_weeks.get(top) or []
        hits = int(aw[-1][1]) if aw else int(flag_count.get(top, 0))
        if hits > 0:
            fw = lw = 0
            if (
                show_delta and len(aw) >= 2
            ):  # '주 N→M' 은 표본 충분(주≥MIN_DELTA)일 때만
                fw, lw = int(aw[0][1]), int(aw[-1][1])
            rstat = RecurringStat(
                sub_problem=top,
                window=n_weeks,
                hits=hits,
                ratio=round(hits / max(1, n_weeks), 2),
                first_week_hits=fw,
                last_week_hits=lw,
            )

    # ⑦ 인사이트(주 N→M)는 rstat 경로로 프론트가 조립 — 라벨 없는 delta_note 는 미사용.
    delta = None

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

    # narration = 백엔드 자유 note 그대로(있을 때). ⑦ 주 N→M 문장은 프론트 growthMessage 가 rstat
    #   (수치)+축 라벨로 조립하므로 여기서 라벨 문장을 만들지 않는다(라벨 소스는 프론트 단일).
    narration = (note or "").strip()

    g = Growth(
        narration=narration,
        recurring_stat=rstat,
        trend=tpoints,
        delta_note=delta,
        chips=chips,
        first=bool(first),
    )
    # 자료가 사실상 없으면 None(프론트가 섹션 숨기기 쉽게). 단 first(첫 가이드)면 '처음 사용' 안내를
    #   띄워야 하므로 유지한다.
    if (
        not first
        and not tpoints
        and rstat is None
        and not chips.current_stage_axes
        and not chips.improving_axes
        and not narration
    ):
        return None
    return g
