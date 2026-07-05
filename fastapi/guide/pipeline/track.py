"""guide/pipeline/track.py — 5단계 커리큘럼 트랙 조립(정의 데이터 단일 소스).

schema/track_map.yaml 을 유일 소스로 축 → track{group, stages[5], current_idx} 를 조립한다.
LLM·프롬프트·스코어링과 무관한 순수 정의 조회(하드코딩 라벨 0). 매핑 성격 규정은 yaml 헤더 참조:
axis→group 은 준객관 분류(안정), axis→stage 는 제품 설계 결정(조정 가능, 단계 변경=설계 변경).
"""

import os
import yaml
from functools import lru_cache

TRACK_MAP_PATH = os.environ.get(
    "TRACK_MAP_PATH",
    os.path.join(os.path.dirname(__file__), "..", "schema", "track_map.yaml"),
)


@lru_cache
def _track_map():
    with open(TRACK_MAP_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_track(axis):
    """축 id → {group, stages[5], current_idx} 또는 None(미정의 축/입력 없음).

    group 은 표시용 한글 라벨(yaml groups[key].label). current_idx 는 이 가이드가 다루는 축
    (primary_focus)의 커리큘럼 단계. stages 는 그룹의 정본 5단계 셀 라벨 그대로. 프론트는
    current_idx 로 바 fill·현재/다음 badge 를 렌더(자체 라벨 정의 금지). 교습전용 축도 사용자
    키워드로 primary_focus 가 될 수 있어 동일하게 track 을 반환한다(usage 는 정의 파일 메타일 뿐).
    """
    if not axis:
        return None
    m = _track_map()
    entry = (m.get("axes") or {}).get(axis)
    if not entry:
        return None
    g = (m.get("groups") or {}).get(entry.get("group"))
    if not g:
        return None
    stages = list(g.get("stages") or [])
    if len(stages) != 5:
        return None
    idx = max(0, min(4, int(entry.get("stage", 0))))
    return {"group": g.get("label") or entry.get("group"), "stages": stages, "current_idx": idx}
