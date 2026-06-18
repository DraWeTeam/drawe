"""test_growth_guardrails.py — 성장/가드레일 계약 회귀 테스트.

리팩터(포즈 3-tier · bbox 하이브리드 · 오버레이 · 모드 선택)가 '측정=사실 / 내부 신호 비노출'
불변식을 깨지 않았는지 *조용히 어긋나기 쉬운* 5개 계약을 고정한다.

  1. 내부 stage(foundation/developing/refining)·평가어 누출 금지
  2. measured=False 불변식(오버레이 없음·화살표 없음·확정 문장 없음)
  3. pose_tier 계약(OK: pose+bbox / LOW: -pose +bbox / FAIL: -pose -bbox)
  4. visual_mode 계약(cold → overlay 없음 / recurring+measured → overlay)
  5. INSTRUMENT_VERSION 범프(측정 해석 변경 → 과거 성장기록과 분리)

실행: cd fastapi && python -m pytest tests/test_growth_guardrails.py -q
전제: overlay.py + patch1·2·4·5 적용 상태(루프 패치는 무관).
"""

import pathlib
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(
    0, str(pathlib.Path(__file__).resolve().parents[1])
)  # fastapi/ → guide 임포트

from guide.pipeline.diagnose import (  # noqa: E402
    diagnose,
    pose_reliability,
    instrument_version,
    INSTRUMENT_VERSION,
    POSE_OK,
    POSE_LOW,
    POSE_FAIL,
)
from guide.pipeline.profiles import POSE_DEPENDENT  # noqa: E402
from guide.pipeline.overlay import (  # noqa: E402
    select_visual_mode,
    resolve_anchors,
    build_overlay,
    _LABEL,
)
from guide.contract import _scan, _STAGE  # noqa: E402
from guide.safety.validate import FORBIDDEN  # noqa: E402
from guide.pipeline import growth_stage  # noqa: E402


# ── 테스트 빌더 ────────────────────────────────────────────────────────────────────────────
def _img():
    """흰 종이 + 중앙 어두운 인물형 블롭(구도·명도 측정 가능)."""
    a = np.ones((300, 200))
    a[60:240, 70:130] = 0.12
    return Image.fromarray((a * 255).astype("uint8"), mode="L").convert("RGB")


def _kp(vis=0.9):
    kp = [(0.5, 0.5, vis)] * 33
    pts = {
        0: (0.5, 0.18),
        11: (0.42, 0.30),
        12: (0.58, 0.30),
        23: (0.44, 0.55),
        24: (0.56, 0.55),
        13: (0.36, 0.42),
        14: (0.64, 0.42),
        15: (0.32, 0.55),
        16: (0.68, 0.55),
        25: (0.45, 0.74),
        26: (0.55, 0.74),
        27: (0.46, 0.95),
        28: (0.54, 0.95),
    }
    for i, (x, y) in pts.items():
        kp[i] = (x, y, vis)
    return kp


def _spatial(tier):
    """오버레이 입력용 spatial(테스트 직접 구성)."""
    if tier == POSE_OK:
        return {
            "keypoints": _kp(),
            "bbox": (0.30, 0.12, 0.70, 0.98),
            "centroid": (0.52, 0.55),
            "horizon_y": 0.66,
        }
    if tier == POSE_LOW:
        return {
            "keypoints": None,
            "bbox": (0.30, 0.12, 0.70, 0.98),
            "centroid": (0.52, 0.55),
            "horizon_y": 0.66,
        }
    return {
        "keypoints": None,
        "bbox": None,
        "centroid": (0.52, 0.55),
        "horizon_y": 0.66,
    }


# ── 1. 내부 stage / 평가어 누출 금지 ──────────────────────────────────────────────────────
def test_stage_constants_are_internal_strings():
    # 불변식의 대상이 실제로 이 세 문자열임을 고정(누구도 슬쩍 노출 라벨로 바꾸지 못하게)
    assert (
        growth_stage.FOUNDATION,
        growth_stage.DEVELOPING,
        growth_stage.REFINING,
    ) == ("foundation", "developing", "refining")


@pytest.mark.parametrize("leak", ["foundation", "developing", "refining"])
def test_scan_catches_internal_stage_leak(leak):
    # 응답 payload 어디에 stage 가 들어가도 경계 스캐너가 잡아야 한다
    payload = {"one_thing": "ok", "blocks": [{"observation": f"... {leak} ..."}]}
    hits = _scan(payload)
    assert any(kind == "stage" for kind, _ in hits)


@pytest.mark.parametrize("word", ["초보", "실력", "등급", "점수", "잘 그렸"])
def test_scan_and_forbidden_catch_eval_words(word):
    assert FORBIDDEN.search(word)  # LLM 출력 가드(validate)
    assert _scan({"x": f"이건 {word} 관련"})  # 응답 경계 가드(contract)


def test_clean_payload_has_no_false_positive():
    payload = {
        "one_thing": "원경 명암을 한 단계 눌러보세요",
        "blocks": [{"observation": "구도"}],
    }
    assert _scan(payload) == []


def test_overlay_labels_are_clean():
    # 그림 위 라벨은 사용자 노출 → 내부 stage·평가어가 절대 없어야 한다
    for label in _LABEL.values():
        assert not _STAGE.search(label), f"stage 누출: {label}"
        assert not FORBIDDEN.search(label), f"평가어 누출: {label}"


# ── 2. measured=False 불변식 ──────────────────────────────────────────────────────────────
def test_resolve_anchors_skips_unmeasured():
    obs = [
        {"sub_problem": "composition_balance", "measured": True},
        {"sub_problem": "light_direction", "measured": False},
    ]
    anns = resolve_anchors(obs, _spatial(POSE_OK), POSE_OK)
    axes = {a["axis"] for a in anns}
    assert "composition_balance" in axes
    assert "light_direction" not in axes  # 못 잰 축은 앵커 없음


def test_overlay_has_no_marks_for_unmeasured():
    obs = [
        {"sub_problem": "composition_balance", "measured": True},
        {"sub_problem": "light_direction", "measured": False},
    ]
    svg = build_overlay(
        800, 1000, resolve_anchors(obs, _spatial(POSE_OK), POSE_OK), POSE_OK
    )
    assert _LABEL["composition_balance"] in svg
    assert _LABEL["light_direction"] not in svg  # 라벨·화살표 없음


def test_unmeasured_observation_has_empty_signal():
    # FAIL 에서 user_terms 로 포즈축을 끌어와도 measured=False → signal 비움(확정 주장 금지)
    dx = diagnose({}, {"status": "skipped"}, _img(), [], user_terms=("proportion",))
    prop = next(
        (o for o in dx["observations"] if o["sub_problem"] == "proportion"), None
    )
    assert prop is not None and prop["measured"] is False
    assert not prop["signal"]  # 빈 문자열/None — 측정 근거 없는 단정 금지


# ── 3. pose_tier 계약 ──────────────────────────────────────────────────────────────────────
def test_pose_reliability_tiers():
    assert pose_reliability({"status": "skipped"}) == POSE_FAIL
    assert (
        pose_reliability({"status": "low_confidence", "keypoints": _kp()}) == POSE_LOW
    )
    assert pose_reliability({"status": "ok", "keypoints": _kp()}) == POSE_OK


def test_tier_signal_contract():
    img = _img()
    pose_dep = set(POSE_DEPENDENT)

    # OK: pose O, bbox O
    ok = diagnose({}, {"status": "ok", "keypoints": _kp()}, img, [])
    assert ok["pose_tier"] == POSE_OK
    assert ok["spatial"]["keypoints"] is not None  # 관절 신호 사용
    assert ok["spatial"]["bbox"] is not None
    assert pose_dep & set(ok["measurable"])  # 포즈축 측정 대상

    # LOW: pose X, bbox O
    low = diagnose({}, {"status": "low_confidence", "keypoints": _kp()}, img, [])
    assert low["pose_tier"] == POSE_LOW
    assert low["spatial"]["keypoints"] is None  # 관절 비신뢰 → 미사용
    assert low["spatial"]["bbox"] is not None  # 형체 위치는 사용(하이브리드)
    assert not (pose_dep & set(low["measurable"]))  # 포즈축 측정 제외

    # FAIL: pose X, bbox X
    fail = diagnose({}, {"status": "skipped"}, img, [])
    assert fail["pose_tier"] == POSE_FAIL
    assert fail["spatial"]["keypoints"] is None
    assert fail["spatial"]["bbox"] is None
    assert not (pose_dep & set(fail["measurable"]))


# ── 4. visual_mode 계약 ────────────────────────────────────────────────────────────────────
def test_visual_mode_cold_no_overlay():
    obs = [{"sub_problem": "composition_balance", "measured": True}]
    m = select_visual_mode(obs, {"cold": True, "steady": [], "recurring": []})
    assert m["overlay_axes"] == []  # 첫 사용자 → 전부 이론
    assert m["theory_axes"] == ["composition_balance"]


def test_visual_mode_recurring_goes_overlay():
    obs = [
        {"sub_problem": "composition_balance", "measured": True},
        {"sub_problem": "value_structure", "measured": True},
    ]
    m = select_visual_mode(
        obs, {"cold": False, "steady": [], "recurring": ["composition_balance"]}
    )
    assert m["overlay_axes"] == ["composition_balance"]  # 반복+측정 축만 오버레이
    assert m["theory_axes"] == ["value_structure"]  # 신규 축은 이론


def test_visual_mode_recurring_but_unmeasured_stays_theory():
    # 반복 축이라도 이번 그림에서 못 쟀으면 오버레이 금지(가드레일 우선)
    obs = [{"sub_problem": "composition_balance", "measured": False}]
    m = select_visual_mode(obs, {"cold": False, "recurring": ["composition_balance"]})
    assert m["overlay_axes"] == []
    assert m["theory_axes"] == ["composition_balance"]


# ── 5. INSTRUMENT_VERSION 범프 ─────────────────────────────────────────────────────────────
def test_instrument_version_bumped():
    # 이번 변경(LOW 처리·bbox·오버레이·visual_mode)은 측정 해석을 바꿨다.
    # 버전이 안 올라가면 과거/현재 성장기록이 섞인다. 의도적 범프를 테스트로 고정.
    assert INSTRUMENT_VERSION != "dx-2026.06"  # 변경 전 값이면 실패
    assert INSTRUMENT_VERSION == "dx-2026.08"  # 범프 시 이 줄을 의식적으로 갱신할 것
    assert instrument_version().startswith(INSTRUMENT_VERSION)  # +mask 접미사만 허용


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
