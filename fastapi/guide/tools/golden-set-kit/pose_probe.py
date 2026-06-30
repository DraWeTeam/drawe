"""pose 실측: 골든셋 각 이미지의 mediapipe PoseLandmarker 검출 상태를 덤프한다(D 세션 기준선).

목적: "BlazePose 가 드로잉 전신을 못 잡는다"를 가설이 아니라 *실측*으로 못박는다 —
어느 이미지가 skipped(no_person)/low_confidence/ok 인지, pose_reliability 가 OK/LOW/FAIL 중
무엇으로 강등하는지, 그래서 POSE_DEPENDENT 축(proportion/weight_balance/action_line 등)이
발화 가능한지. 라벨의 expected_primary 와 나란히 놓아 '막힌 점수'를 가시화한다.

실행(컨테이너):
  docker exec -w /app -e PYTHONPATH=/app drawe-guide python guide/tools/golden-set-kit/pose_probe.py
"""
import json
import os
from io import BytesIO

from guide.ml.normalize import normalize
from guide.ml.scene import analyze
from guide.ml.pose import extract
from guide.pipeline.diagnose import pose_reliability, POSE_DEPENDENT
from guide.eval.axis_eval import predict_axis

KIT = os.path.dirname(os.path.abspath(__file__))
labels = json.load(open(os.path.join(KIT, "labels.json"), encoding="utf-8"))
imgs = {x["file"]: x for x in labels["images"]}
itracks = labels["intended_tracks"]

VIS_KP = 0.3  # diagnose._figure_bbox 의 개별 키포인트 가시 하한과 동일


def probe(path):
    with open(path, "rb") as f:
        pil = normalize(BytesIO(f.read()))
    scene = analyze(pil)
    pose = extract(pil=pil, scene=scene)
    tier = pose_reliability(pose)
    kp = pose.get("keypoints") or []
    n_vis = sum(1 for (x, y, v) in kp if v >= VIS_KP and 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0)
    prom = float(scene.get("subject", {}).get("person", {}).get("prominence", 0.0))
    return {
        "status": pose.get("status"),
        "reason": pose.get("reason"),
        "mean_vis": pose.get("mean_visibility"),
        "n_kp": len(kp),
        "n_vis_kp": n_vis,
        "tier": tier,
        "person_prom": prom,
    }


# figure track 만 전신 pose 가 핵심(face/hand/landscape 는 pose 비의존). 그래도 전부 찍어 person_prom 확인.
print(f"{'file':38} {'lbl_track':10} {'exp_primary':16} {'status':14} {'tier':5} {'mvis':5} {'nvis':4} {'prom':5} {'auto_primary':16}")
print("-" * 140)
fig_fail = 0
fig_total = 0
for f in sorted(imgs):
    lab = imgs[f]
    path = os.path.join(KIT, "images", f)
    p = probe(path)
    try:
        auto, _ = predict_axis(path, track=None)
    except Exception as e:
        auto = f"(err:{type(e).__name__})"
    mvis = f"{p['mean_vis']:.2f}" if p["mean_vis"] is not None else "  - "
    track = lab.get("track", "?")
    is_fig = track == "figure"
    if is_fig:
        fig_total += 1
        if p["tier"] != "ok":
            fig_fail += 1
    mark = " *" if (is_fig and p["tier"] != "ok") else "  "
    print(f"{f:38} {track:10} {lab.get('expected_primary',''):16} "
          f"{str(p['status'])+'/'+str(p['reason'] or ''):14} {p['tier']:5} {mvis:5} "
          f"{p['n_vis_kp']:>4} {p['person_prom']:.2f}  {str(auto):16}{mark}")

print("-" * 140)
print(f"POSE_DEPENDENT 축: {sorted(POSE_DEPENDENT)}")
print(f"figure track {fig_total}장 중 pose tier!=ok(전신축 막힘): {fig_fail}장  (* 표시)")
print("done")
