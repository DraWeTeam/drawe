"""card_probe.py — '카드'의 결정적 조각 실측(LLM 없이). run_guide 가 블록에 붙이는 guide_asset 과
taxonomy 의 축별 카드 텍스트(what_to_observe·practice_prompt)를 그대로 덤프해, facial_proportion 과
proportion 의 현재 카드 출력 구조 차이(=연결할 갭)를 눈으로 본다.

실행: docker exec -w /app -e PYTHONPATH=/app drawe-guide python guide/tools/golden-set-kit/card_probe.py
"""
import json
import os

import yaml

from guide.pipeline import assets

p = os.path.join(os.path.dirname(assets.__file__), "..", "schema", "taxonomy.yaml")
with open(p, encoding="utf-8") as f:
    raw = yaml.safe_load(f)
TAX = {x["id"]: x for x in raw} if isinstance(raw, list) else raw

AXES = ["proportion", "facial_proportion"]
for sp in AXES:
    print("=" * 90)
    print(f"축: {sp}")
    t = TAX.get(sp, {})
    print(f"  taxonomy.what_to_observe : {t.get('what_to_observe', '(없음)')}")
    print(f"  taxonomy.practice_prompt : {t.get('practice_prompt', '(없음)')}")
    print(f"  AXIS_PREF       : {assets.AXIS_PREF.get(sp, '(없음 → _DEFAULT_PREF=' + str(assets._DEFAULT_PREF) + ')')}")
    print(f"  in AI_AVOID?    : {sp in assets.AI_AVOID}")
    print(f"  in POSE_DEPENDENT?: {sp in assets.POSE_DEPENDENT}")
    print(f"  _FLOOR_CAPTION  : {assets._FLOOR_CAPTION.get(sp, '(없음 → _GENERIC_CAPTION)')}")
    print(f"  has _FLOOR_SVG? : {sp in assets._FLOOR_SVG}")
    # 실제 적재 자료 없이(=현재 운영 다수 케이스) pick 결과 = 바닥
    picked = assets.pick(sp, loaded=None, degraded=False)
    print(f"  assets.pick(loaded=None) → {json.dumps(picked, ensure_ascii=False)}")
    svg = assets.floor_svg(sp)
    print(f"  floor_svg len={len(svg)} generic={'_GENERIC_SVG' if sp not in assets._FLOOR_SVG else 'dedicated'}")
    print(f"  floor_svg: {svg}")
print("=" * 90)
print("done")
