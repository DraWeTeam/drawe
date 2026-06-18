"""축 정확도 평가 — 라벨된 이미지로 진단의 *1차 축* 예측이 맞는지 측정한다(LLM·검색 없이 진단만).

왜: "손 스케치인데 명암 가이딩" 같은 오분류를 회귀 테스트로 잡기 위함. scene/profile/diagnose 를
손대면 풍경↔인물 역회귀가 날 수 있어, 라벨셋으로 before/after 정확도를 봐야 한다.

배치(폴더명 = 기대하는 1차 sub_problem):
    fastapi/tests/eval_axis/hand_structure/손스케치1.png
    fastapi/tests/eval_axis/proportion/전신1.jpg
    fastapi/tests/eval_axis/atmospheric_perspective/풍경1.png
    ...

실행:
    cd fastapi && python -m guide.eval.axis_eval                 # 기본 tests/eval_axis
    cd fastapi && python -m guide.eval.axis_eval <폴더> "<메시지>"  # 메시지(칩/문구)도 함께 평가

출력: 케이스별 expected vs predicted(OK/X) + 폴더별·전체 정확도.
주의: torch/open_clip/mediapipe 등 실제 모델이 필요하다(가이드 서비스와 동일 환경에서 실행).
"""

import os
import sys
import glob
from io import BytesIO

from guide.ml.normalize import normalize
from guide.ml.scene import analyze
from guide.ml.pose import extract
from guide.pipeline.router import resolve
from guide.pipeline.profiles import resolve_profile
from guide.pipeline.diagnose import diagnose, image_signals, hand_signals

_EXT = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")


def predict_axis(path, message="", track=None, debug=False):
    """이미지 1장 → 진단 1차 축(sub_problem). early(거절/리다이렉트/clarify)면 '(mode=...)'.
    debug=True 면 (primary, dx, dbg) — dbg에 scene 점수·track·신호값·랭킹된 축을 담는다."""
    with open(path, "rb") as f:
        pil = normalize(BytesIO(f.read()))
    scene = analyze(pil)
    pose = extract(scene, pil)
    mode, personas, user_terms = resolve(message, scene)
    if mode != "coach":
        return (f"(mode={mode})", None, None) if debug else (f"(mode={mode})", None)
    profile = resolve_profile(track, scene)
    dx = diagnose(scene, pose, pil, personas, user_terms, growth=None, profile=profile)
    obs = dx.get("observations") or []
    primary = dx.get("primary_focus") or (obs[0]["sub_problem"] if obs else None)
    if not debug:
        return primary, dx
    sig = image_signals(pil)  # line_sketch·value 신호 재계산(진단 내부와 동일)
    hand = hand_signals(pil)  # HAND_AUTO 켜졌을 때만 _hand(HandLandmarker 손 검출 여부)
    subj = scene.get("subject", {})
    dbg = {
        "person_prom": subj.get("person", {}).get("prominence"),
        "track": profile.get("label"),
        "personas": personas,
        "user_terms": sorted(user_terms),
        "pose_status": pose.get("status"),
        "hand_detected": bool(hand.get("_hand")),
        "line_sketch": sig.get("line_sketch"),
        "value_std": round(float(sig.get("value_std", 0)), 3),
        "light_frac": round(float(sig.get("light_frac", 0)), 3),
        "value_range_robust": sig.get("value_range_robust"),
        "ranked": [(o["sub_problem"], o["confidence"], o["measured"]) for o in obs],
    }
    return primary, dx, dbg


def run(root="tests/eval_axis", message="", debug=False):
    cases = []
    for axis_dir in sorted(glob.glob(os.path.join(root, "*"))):
        if not os.path.isdir(axis_dir):
            continue
        expected = os.path.basename(axis_dir)
        for img in sorted(glob.glob(os.path.join(axis_dir, "*"))):
            if img.lower().endswith(_EXT):
                cases.append((expected, img))
    if not cases:
        print(
            f"[axis_eval] 이미지 없음. {root}/<기대축>/<이미지> 형태로 배치하세요.\n"
            f"  예: {root}/hand_structure/손스케치1.png"
        )
        return

    per = {}  # expected → [hit, total]
    ok = 0
    print(f"{'expected':26} {'predicted':26} ?   file")
    print("-" * 80)
    for expected, img in cases:
        dbg = None
        try:
            if debug:
                pred, _, dbg = predict_axis(img, message=message, debug=True)
            else:
                pred, _ = predict_axis(img, message=message)
        except Exception as e:  # 한 장 실패해도 전체 평가는 계속
            pred = f"(err:{type(e).__name__}:{e})"
        hit = pred == expected
        ok += hit
        d = per.setdefault(expected, [0, 0])
        d[0] += hit
        d[1] += 1
        print(
            f"{expected:26} {str(pred):26} {'OK' if hit else 'X '} {os.path.basename(img)}"
        )
        if dbg:
            print(
                f"    person={dbg['person_prom']:.2f} → track={dbg['track']}"
                f" personas={dbg['personas']} user_terms={dbg['user_terms']}"
            )
            print(
                f"    pose={dbg['pose_status']} hand_detected={dbg['hand_detected']}"
                f" line_sketch={dbg['line_sketch']} value_std={dbg['value_std']}"
                f" light_frac={dbg['light_frac']} vrr={dbg['value_range_robust']}"
            )
            print(f"    ranked={dbg['ranked']}")

    print("-" * 80)
    for axis, (h, t) in sorted(per.items()):
        print(f"  {axis:26} {h}/{t}")
    print(f"\n전체 정확도: {ok}/{len(cases)} = {ok / len(cases) * 100:.0f}%")


if __name__ == "__main__":
    # 사용: python -m guide.eval.axis_eval [폴더] [메시지] [--debug]
    a = [x for x in sys.argv[1:] if x != "--debug"]
    dbg = "--debug" in sys.argv
    root = a[0] if len(a) > 0 else "tests/eval_axis"
    msg = a[1] if len(a) > 1 else ""
    run(root, msg, debug=dbg)
