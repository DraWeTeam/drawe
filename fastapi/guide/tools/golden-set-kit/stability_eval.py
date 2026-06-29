"""stability_eval.py — 호출간 VLM 안정성 검증(평가 위생 §3: 반복으로 안정성 분포).

왜: VLM 은 호출마다 view/eye_line 이 뒤집힌다(메모리 eval-methodology-golden-set §2 실측). 그래서
골든셋을 1~2회만 통과시킨 "정확도"는 '시스템이 맞힘'인지 '이번 호출이 우연히 맞는 자리에 떨어짐'인지
구분할 수 없다. 특히 E(face)의 +3(face 3장 → facial_proportion)이 라우팅이 살아 생긴 신호인지,
운 좋은 1회였는지 가르려면 같은 그림을 N회 *독립* 통과시켜 최종 축 분포를 봐야 한다.

핵심(함정): observe_face/observe_hand/classify_* 는 이미지 해시로 결과를 캐시한다(cache.vlm_*,
L1 in-process + L2 valkey). 그냥 N회 부르면 2회차부터 전부 캐시 hit → '완벽한 안정성'이라는
가짜 신호가 나온다(캐시 결정성을 재게 됨). 따라서 *반복 사이에* 캐시를 flush 한다. 단 한 번의
predict_axis *내부*에서는 캐시를 살려 둔다(검출용 observe_face 와 신호용 observe_face 가 한 draw-set
을 공유 = 프로덕션 충실). 즉 캐시는 "호출 내 공유 O, 호출 간 fresh".

수집 3층:
  1) rep 단위 — 최종 1차 축(scored_baseline 가 보는 값) + 라우팅된 track.
  2) observe_face/hand 요약 — consistent/confidence/view/eye_line(게이트가 안정화에 기여하는지).
  3) draw 단위 — 매 VLM draw 의 raw parse(is_portrait/view/eye_line) flip 율.

실행(컨테이너):
  docker exec -w /app -e PYTHONPATH=/app -e TRACE_CTX=0 \
    -e FACE_VLM=1 -e HAND_VLM=1 -e SUBJECT_VLM=1 -e STYLE_VLM=1 -e VLM_BACKEND=vertex \
    drawe-guide python guide/tools/golden-set-kit/stability_eval.py face 5
인자: [set=face|hand|all] [N=5]
"""
import collections
import json
import os
import sys

import guide.cache as cache
import guide.ml.vision as vision

KIT = os.path.dirname(os.path.abspath(__file__))
labels = json.load(open(os.path.join(KIT, "labels.json"), encoding="utf-8"))
imgs = {x["file"]: x for x in labels["images"]}
itracks = labels["intended_tracks"]

FACE_FILES = ["face_001_front_normal.png", "face_002_profile_side.png", "face_003_three_quarter.png"]
HAND_FILES = ["hand_001_v_sign_line.png", "hand_002_colored_palm.png",
              "hand_003_long_fingers.png", "hand_004_foreshortened.png", "hand_005_message_ratio.png"]


def flush_vlm():
    """반복 사이 캐시 비우기 — 호출 간 fresh VLM draw 강제. L1 dict + valkey vlm:* 둘 다."""
    cache._VLM_L1.clear()
    c = cache._client()
    if c is not None:
        try:
            for k in c.scan_iter("vlm:*"):
                c.delete(k)
        except Exception as e:
            print(f"[flush] valkey 삭제 실패(L1만 비움): {type(e).__name__}: {e}")


# ── draw 단위 캡처: _parse_face/_parse 를 래핑해 매 VLM draw 의 raw parse 를 기록 ──────────────
_draws = collections.defaultdict(list)  # img_file → [parsed dict per draw]
_cur = {"file": None}
_orig_parse_face = vision._parse_face
_orig_parse = vision._parse


def _wrap_parse_face(text):
    p = _orig_parse_face(text)
    if p is not None and _cur["file"]:
        _draws[_cur["file"]].append({"is_portrait": p["is_portrait"], "view": p["view"], "eye_line": p["eye_line"]})
    return p


def _wrap_parse(text):
    p = _orig_parse(text)
    if p is not None and _cur["file"]:
        _draws[_cur["file"]].append({"view": p["view"], "structure": p["structure"]})
    return p


vision._parse_face = _wrap_parse_face
vision._parse = _wrap_parse

# ── observe 요약 캡처: observe_face/observe_hand 래핑(게이트 후 요약) ──────────────────────────
_summ = collections.defaultdict(list)  # img_file → [summary dict per observe call]
_orig_face = vision.observe_face
_orig_hand = vision.observe_hand


def _wrap_face(image, runs=2):
    r = _orig_face(image, runs=runs)
    if _cur["file"] and r is not None:
        _summ[_cur["file"]].append({"kind": "face", "consistent": r["consistent"], "confidence": r["confidence"],
                                    "is_portrait": r["is_portrait"], "view": r["view"], "eye_line": r["eye_line"]})
    return r


def _wrap_hand(image, runs=2):
    r = _orig_hand(image, runs=runs)
    if _cur["file"] and r is not None:
        _summ[_cur["file"]].append({"kind": "hand", "consistent": r["consistent"], "confidence": r["confidence"],
                                    "view": r["view"], "structure": r["structure"]})
    return r


vision.observe_face = _wrap_face
vision.observe_hand = _wrap_hand

# predict_axis 는 위 패치 이후 import(lazy import 가 패치된 vision 속성을 집게 함)
from guide.eval.axis_eval import predict_axis  # noqa: E402


def run_set(files, N):
    print(f"\n{'=' * 100}\n안정성 측정: {len(files)}장 × {N}회 (호출 간 캐시 flush)\n{'=' * 100}")
    for f in files:
        if f not in imgs:
            print(f"  (skip: labels 에 없음 {f})")
            continue
        path = os.path.join(KIT, "images", f)
        track = itracks.get(f)
        lab = imgs[f]
        acc = set(lab.get("acceptable", []))
        _draws[f] = []
        _summ[f] = []
        finals = []
        tracks = []
        for i in range(N):
            flush_vlm()
            _cur["file"] = f
            try:
                primary, _, dbg = predict_axis(path, track=track, debug=True)
            except Exception as e:
                primary, dbg = f"(err:{type(e).__name__})", {}
            finals.append(primary)
            tracks.append(dbg.get("track") if dbg else None)
        _cur["file"] = None

        fc = collections.Counter(finals)
        hits = sum(1 for p in finals if p in acc)
        print(f"\n── {f}  [clarity={lab['clarity']} track={track} expected={lab.get('expected_primary')}]")
        print(f"   acceptable={sorted(acc)}")
        print(f"   최종축 분포: {dict(fc)}   →  acceptable hit {hits}/{N}")
        print(f"   라우팅 track 분포: {dict(collections.Counter(str(t) for t in tracks))}")
        # observe 요약 분포 — kind 별로 분리(figure/pose 경로가 face 그림에도 observe_hand 를 부른다)
        sm_face = [s for s in _summ[f] if s["kind"] == "face"]
        sm_hand = [s for s in _summ[f] if s["kind"] == "hand"]
        if sm_face:
            conf = collections.Counter(s["confidence"] for s in sm_face)
            cons = collections.Counter(s["consistent"] for s in sm_face)
            pv = collections.Counter(s["view"] for s in sm_face)
            pe = collections.Counter(s["eye_line"] for s in sm_face)
            pp = collections.Counter(s["is_portrait"] for s in sm_face)
            print(f"   observe[face] n={len(sm_face)} confidence={dict(conf)} consistent={dict(cons)}")
            print(f"   observe[face] is_portrait={dict(pp)} view={dict(pv)} eye_line={dict(pe)}")
        if sm_hand:
            conf = collections.Counter(s["confidence"] for s in sm_hand)
            cons = collections.Counter(s["consistent"] for s in sm_hand)
            pv = collections.Counter(s["view"] for s in sm_hand)
            ps = collections.Counter(s["structure"] for s in sm_hand)
            print(f"   observe[hand] n={len(sm_hand)} confidence={dict(conf)} consistent={dict(cons)} view={dict(pv)} structure={dict(ps)}")
        # draw 단위 raw 분포 — face draw(eye_line 있음)와 hand draw(structure 있음) 분리
        df = [d for d in _draws[f] if "eye_line" in d]
        dh = [d for d in _draws[f] if "structure" in d]
        if df:
            dv = collections.Counter(d["view"] for d in df)
            de = collections.Counter(d["eye_line"] for d in df)
            dp = collections.Counter(d["is_portrait"] for d in df)
            print(f"   draw raw[face](n={len(df)}): is_portrait={dict(dp)} view={dict(dv)} eye_line={dict(de)}")
        if dh:
            dv = collections.Counter(d["view"] for d in dh)
            ds = collections.Counter(d["structure"] for d in dh)
            print(f"   draw raw[hand](n={len(dh)}): view={dict(dv)} structure={dict(ds)}")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "face"
    N = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    files = FACE_FILES if which == "face" else HAND_FILES if which == "hand" else FACE_FILES + HAND_FILES
    run_set(files, N)
    print("\ndone")
