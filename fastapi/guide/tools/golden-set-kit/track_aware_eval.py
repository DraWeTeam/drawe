"""track-aware 재평가: 같은 골든셋을 (1) 자동경로(track=None) vs (2) 명시 track(프로덕션 충실)
   로 각각 통과시켜 정확도를 분리 측정. style→norm 라우팅(C)의 진짜 값어치를 드러낸다.
   채점: pred ∈ acceptable. abstain 기대(blank 등)는 (mode=...) 응답을 abstain/clarify로 인정.

   실행(컨테이너): docker exec -w /app -e PYTHONPATH=/app drawe-guide python guide/tools/golden-set-kit/track_aware_eval.py
   전제: labels.json 에 images[].acceptable 와 intended_tracks 가 있어야 한다."""
import json
import os
from guide.eval.axis_eval import predict_axis

KIT = os.path.dirname(os.path.abspath(__file__))
labels = json.load(open(os.path.join(KIT, "labels.json"), encoding="utf-8"))
itracks = labels["intended_tracks"]
imgs = {x["file"]: x for x in labels["images"]}
ABSTAIN = {"abstain", "clarify", "refuse", "no_subject", "routing_conflict", "routing_mismatch"}


def score(pred, lab):
    acc = set(lab.get("acceptable", []))
    if isinstance(pred, str) and pred.startswith("(mode="):
        return bool(acc & ABSTAIN)  # 시스템 abstain ↔ 기대 abstain
    return pred in acc


def run_one(path, track):
    try:
        pred, _ = predict_axis(path, track=track)
        return pred
    except Exception as e:
        return f"(err:{type(e).__name__})"


rows = []
for f in sorted(imgs):
    lab = imgs[f]
    path = os.path.join(KIT, "images", f)
    it = itracks.get(f)
    auto = run_one(path, None)
    tracked = run_one(path, it) if it else auto
    rows.append((f, lab["clarity"], it, auto, score(auto, lab), tracked, score(tracked, lab)))

print(f"{'file':38} {'clr':6} {'intended':16} {'auto':22} a {'tracked':22} t")
print("-" * 124)
for f, clr, it, auto, sa, tr, st in rows:
    print(f"{f:38} {clr:6} {str(it):16} {str(auto):22} {'O' if sa else 'X'} {str(tr):22} {'O' if st else 'X'}")

clear = [r for r in rows if r[1] == "clear"]
amb = [r for r in rows if r[1] == "ambiguous"]
print("-" * 124)
print(f"명확셋({len(clear)}) auto:    {sum(r[4] for r in clear)}/{len(clear)}")
print(f"명확셋({len(clear)}) tracked: {sum(r[6] for r in clear)}/{len(clear)}")
print(f"애매셋({len(amb)}) auto: {sum(r[4] for r in amb)}/{len(amb)}  tracked: {sum(r[6] for r in amb)}/{len(amb)}")
moved = [(r[0], r[3], r[5]) for r in rows if r[3] != r[5]]
print(f"\nauto→tracked 바뀐 이미지({len(moved)}):")
for f, a, t in moved:
    print(f"  {f:38} {a} → {t}")
print("done")
