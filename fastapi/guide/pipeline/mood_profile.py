"""guide/pipeline/mood_profile.py — 온보딩 무드 취향(user_pref_tags AXIS_MOOD) → 추천 soft 부스트.

가이드 추천 경로 전용. backend 가 사용자의 무드 태그 문자열(예: "dreamy,cozy")을 guideImage 폼으로
넘기면, 여기서 schema/mood_map.yaml 대응표로 코퍼스 feel-persona 공간으로 바꿔(persona_lean) 검색
점수에 *가산만* 한다. 축 정합(build_filters/boost)이 hard 우선, 무드는 그 위 soft(cap 상한).

설명가능성·비파괴:
  - 부스트 hard 키 = persona_lean(코퍼스 reference_images.personas 와 동일 공간)만.
  - 매핑되는 태그가 하나도 없으면 None → mood_boost 0 → 랭킹 현행과 완전 동일(콜드스타트/미매핑 안전).
  - 이유 문장·UI 는 이번 범위 밖(부스트만). 문장은 UI 정합 통합 시점에.
보수적 파라미터: 온보딩 취향은 그림 관찰보다 약/노이즈한 신호라 기본 cap="S"(0.05) — 축 정합 hard 를
  뒤엎지 않는 얕은 선호 가산.
"""

import os
import yaml
from functools import lru_cache

MOOD_MAP_PATH = os.environ.get(
    "MOOD_MAP_PATH",
    os.path.join(os.path.dirname(__file__), "..", "schema", "mood_map.yaml"),
)

# boost() 계열 스케일(SRC 0.06/PERSONA 0.05/MEDIUM·TRACK 0.04)과 정합. persona 1건 매치 기본 가산.
MOOD_UNIT = 0.06
# persona_lean 순위 가중(상위일수록 큼)
RANK_W = (1.0, 0.6, 0.35)
# soft preference 상한. 온보딩 경로 기본 S(보수적). 축 정합 hard(cosine+0.06+0.05)를 단독으로 못 넘게.
CAPS = {"S": 0.05, "M": 0.10, "L": 0.18}


@lru_cache
def _mood_map():
    with open(MOOD_MAP_PATH, encoding="utf-8") as f:
        return (yaml.safe_load(f) or {}).get("map") or {}


def build_mood_profile(mood_field):
    """무드 태그 문자열(콤마/공백 구분, 가중치 순) → {"persona_lean":[...]} | None.
    대응표에 있는 태그만 반영(exact). 매핑 결과 없으면 None(부스트 0 → 현행 동일).
    persona_lean 은 태그 등장 순서(=backend 가 weight 내림차순으로 보냄)를 보존해 상위 취향을 먼저."""
    if not mood_field:
        return None
    m = _mood_map()
    lean = []
    for raw in str(mood_field).replace(",", " ").split():
        tag = raw.strip().lower()
        entry = m.get(tag)
        if not entry:
            continue  # 미매핑 태그는 무시(비파괴)
        for p in entry.get("personas") or []:
            if p not in lean:
                lean.append(p)
    if not lean:
        return None
    return {"persona_lean": lean[:3], "source": "onboarding"}


def mood_boost(meta, profile, cap="S"):
    """무드 프로파일 ↔ 코퍼스 item persona 정합 → soft 가산(0..cap). persona_lean(코퍼스 공간)만 사용.
    순위 가중: 상위 persona 일치가 더 크게. profile None(미매핑/콜드스타트)이면 0.0 → 랭킹 불변."""
    if not profile:
        return 0.0
    item_personas = set((meta or {}).get("personas") or [])
    lean = profile.get("persona_lean") or []
    s = 0.0
    for i, p in enumerate(lean[:3]):
        if p in item_personas:
            s += MOOD_UNIT * RANK_W[i]
    return min(s, CAPS.get(cap, CAPS["S"]))
