"""phase2_backend_eval.py — VLM 백엔드 교체 사전 검증(aistudio/vertex vs bedrock).

목적: VLM 관찰자(observe_hand/face/pose·classify_*)의 백엔드를 Gemini(aistudio/vertex)에서
  AWS Bedrock Claude Vision 으로 바꿀 수 있는지 *골든셋으로 사전 판정*. 서비스 구성(prod=aistudio)
  무접촉 — 로컬 평가 전용. 프롬프트·골든셋·기대값은 무변, 전송 백엔드만 VLM_BACKEND 로 스위치.

무엇을 재나(백엔드 간 동일 지표):
  1) 축 정확도 — predict_axis 1차 축이 labels.acceptable 안이면 hit(clear/ambiguous 분리).
  2) 게이트/관찰 신호 — observe_* 의 confidence·consistent 분포(HAND/FACE/POSE 게이트가 다르게
     판정되는지). classify_subject/style 은 _call 카운트에 포함.
  3) 레이턴시 — VLM 호출(_call) 당 wall-clock(mean/p50/max).
  4) 실패·파싱오류율 — _call 예외 수 / _parse* None 수.
  5) (bedrock 한정) 토큰 사용량 → 건당 비용 추정(BEDROCK_VLM_PRICE_IN/OUT, $/1M).

실행(컨테이너, 백엔드별 1회씩):
  # baseline (Gemini via vertex)
  docker exec -w /app -e PYTHONPATH=/app -e TRACE_CTX=0 \
    -e FACE_VLM=1 -e HAND_VLM=1 -e POSE_VLM=1 -e SUBJECT_VLM=1 -e STYLE_VLM=1 \
    -e VLM_BACKEND=vertex -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/adc.json \
    -e GOOGLE_CLOUD_PROJECT=<quota_project> -e GOOGLE_CLOUD_LOCATION=global \
    -e OUT=/tmp/phase2_vertex.json \
    drawe-guide python guide/tools/golden-set-kit/phase2_backend_eval.py
  # candidate (Claude Vision via bedrock)
  docker exec ... -e VLM_BACKEND=bedrock -e BEDROCK_AWS_PROFILE=drawe-prod \
    -e OUT=/tmp/phase2_bedrock.json drawe-guide python .../phase2_backend_eval.py

캐시 주의: observe_*/classify_* 는 이미지 해시로 캐시(cache.vlm_*). 백엔드별 캐시 네임스페이스는
  _MODEL(백엔드마다 다름)로 갈리지만, 같은 백엔드를 두 번 돌리면 2회차가 캐시 hit 이라 레이턴시/비용이
  0 으로 나온다 → 매 실행 시작에 vlm 캐시를 flush 한다(호출 간 fresh, 호출 내 공유는 유지).
"""

import collections
import json
import os
import sys
import time

import guide.cache as cache
import guide.ml.vision as vision

KIT = os.path.dirname(os.path.abspath(__file__))
labels = json.load(open(os.path.join(KIT, "labels.json"), encoding="utf-8"))
imgs = {x["file"]: x for x in labels["images"]}
itracks = labels["intended_tracks"]

# VLM 이 실제로 발화하는 주제만(색/구도/명암/풍경 축은 백엔드 불변 — 스위치가 못 바꿈).
PREFIX = ("hand_", "face_", "figure_", "edge_")
SUBSET = [f for f in sorted(imgs) if f.startswith(PREFIX)]
# ONLY=figure_,face_ 처럼 접두 필터로 부분셋만(페어드 대조군·재확인용). 미설정이면 전체 35장.
_only = tuple(p for p in os.environ.get("ONLY", "").split(",") if p)
if _only:
    SUBSET = [f for f in SUBSET if f.startswith(_only)]

ABSTAIN = {"abstain", "clarify", "refuse", "no_subject", "routing_conflict", "routing_mismatch"}


def score(pred, lab):
    acc = set(lab.get("acceptable", []))
    if isinstance(pred, str) and pred.startswith("(mode="):
        return bool(acc & ABSTAIN)
    return pred in acc


def flush_vlm():
    cache._VLM_L1.clear()
    c = cache._client()
    if c is not None:
        try:
            for k in c.scan_iter("vlm:*"):
                c.delete(k)
        except Exception as e:
            print(f"[flush] valkey 삭제 실패(L1만): {type(e).__name__}: {e}")


# ── 계측: _call(전송) latency·count·failure ─────────────────────────────────────────────
_metrics = {"lat": [], "calls": 0, "fail": 0, "errs": collections.Counter()}
_orig_call = vision._call


def _wrap_call(b64, mime, key, model=None, timeout=90, retries=2, prompt=None):
    _metrics["calls"] += 1
    t = time.time()
    try:
        r = _orig_call(b64, mime, key, model=model or vision._MODEL, timeout=timeout, retries=retries, prompt=prompt)
        _metrics["lat"].append(time.time() - t)
        return r
    except Exception as e:
        _metrics["lat"].append(time.time() - t)
        _metrics["fail"] += 1
        _metrics["errs"][type(e).__name__] += 1
        raise


vision._call = _wrap_call

# ── 계측: _parse* 파싱오류율 ────────────────────────────────────────────────────────────
_parse_stat = collections.Counter()  # ok / none
_orig_parse = vision._parse
_orig_parse_face = vision._parse_face
_orig_parse_pose = vision._parse_pose


def _mk_parse_wrap(fn):
    def w(text):
        p = fn(text)
        _parse_stat["none" if p is None else "ok"] += 1
        return p
    return w


vision._parse = _mk_parse_wrap(_orig_parse)
vision._parse_face = _mk_parse_wrap(_orig_parse_face)
vision._parse_pose = _mk_parse_wrap(_orig_parse_pose)

# ── 계측: observe_* 게이트/신호 요약(파일별) ─────────────────────────────────────────────
_summ = collections.defaultdict(list)
_cur = {"file": None}
_orig_hand = vision.observe_hand
_orig_face = vision.observe_face
_orig_pose = vision.observe_pose


def _wrap_hand(image, runs=2):
    r = _orig_hand(image, runs=runs)
    if _cur["file"] and r is not None:
        _summ[_cur["file"]].append({"kind": "hand", "confidence": r["confidence"], "consistent": r["consistent"], "view": r["view"], "fs_tier": r["foreshortening_tier"]})
    return r


def _wrap_face(image, runs=2):
    r = _orig_face(image, runs=runs)
    if _cur["file"] and r is not None:
        _summ[_cur["file"]].append({"kind": "face", "confidence": r["confidence"], "consistent": r["consistent"], "is_portrait": r["is_portrait"], "view": r["view"], "eye_line": r["eye_line"]})
    return r


def _wrap_pose(image, runs=2):
    r = _orig_pose(image, runs=runs)
    if _cur["file"] and r is not None:
        _summ[_cur["file"]].append({"kind": "pose", "confidence": r["confidence"], "consistent": r["consistent"], "is_full_body": r["is_full_body"], "dynamism": r["dynamism"], "balance": r["balance"]})
    return r


vision.observe_hand = _wrap_hand
vision.observe_face = _wrap_face
vision.observe_pose = _wrap_pose

# ── 계측: bedrock 토큰 사용량(비용 추정) ─────────────────────────────────────────────────
_usage = []
if vision._BACKEND == "bedrock":
    import io
    from botocore.response import StreamingBody

    _client = vision._bedrock_client()
    _orig_invoke = _client.invoke_model

    def _wrap_invoke(**kw):
        resp = _orig_invoke(**kw)
        data = resp["body"].read()
        try:
            _usage.append(json.loads(data).get("usage", {}))
        except Exception:
            pass
        resp["body"] = StreamingBody(io.BytesIO(data), len(data))
        return resp

    _client.invoke_model = _wrap_invoke

# predict_axis 는 위 패치 이후 import(패치된 vision 속성을 집게)
from guide.eval.axis_eval import predict_axis  # noqa: E402


def pct(x, n):
    return f"{x}/{n}" + (f" = {x / n * 100:.0f}%" if n else "")


def run():
    backend = vision._BACKEND
    model = vision._MODEL
    flush_vlm()
    print(f"{'=' * 100}\nPhase2 백엔드 평가 | backend={backend} model={model} | {len(SUBSET)}장\n{'=' * 100}")
    print(f"{'file':34} {'clr':5} {'track':16} {'pred':22} ? gate")
    print("-" * 108)
    rows = []
    for f in SUBSET:
        lab = imgs[f]
        path = os.path.join(KIT, "images", f)
        track = itracks.get(f)
        _cur["file"] = f
        try:
            pred, _ = predict_axis(path, track=track)
        except Exception as e:
            pred = f"(err:{type(e).__name__})"
        _cur["file"] = None
        hit = score(pred, lab)
        # 게이트 신호 요약: 이 파일에서 관찰자가 낸 confidence 들
        gates = [f"{s['kind']}:{s['confidence']}" for s in _summ.get(f, [])]
        rows.append((f, lab["clarity"], track, pred, hit, lab.get("acceptable", []), gates))
        print(f"{f:34} {lab['clarity']:5} {str(track):16} {str(pred):22} {'O' if hit else 'X'} {','.join(gates)}")

    clear = [r for r in rows if r[1] == "clear"]
    amb = [r for r in rows if r[1] == "ambiguous"]
    print("-" * 108)
    print(f"clear   정확도: {pct(sum(r[4] for r in clear), len(clear))}")
    print(f"amb     정확도: {pct(sum(r[4] for r in amb), len(amb))}")
    print(f"전체    정확도: {pct(sum(r[4] for r in rows), len(rows))}")
    # 그룹별
    for grp in ("hand", "face", "figure", "edge"):
        g = [r for r in rows if r[0].startswith(grp)]
        if g:
            print(f"  {grp:8} {pct(sum(r[4] for r in g), len(g))}")

    # 레이턴시·실패·파싱
    lat = sorted(_metrics["lat"])
    n = len(lat)
    p50 = lat[n // 2] if n else 0
    mean = sum(lat) / n if n else 0
    print("-" * 108)
    print(f"VLM 호출: {_metrics['calls']}  실패: {_metrics['fail']} {dict(_metrics['errs'])}")
    print(f"레이턴시(초): mean={mean:.2f} p50={p50:.2f} max={(lat[-1] if lat else 0):.2f}")
    print(f"파싱: ok={_parse_stat['ok']} none={_parse_stat['none']} (오류율 {_parse_stat['none']}/{sum(_parse_stat.values()) or 1})")

    # 게이트 confidence 분포(관찰자 종류별)
    allconf = collections.Counter()
    bykind = collections.defaultdict(collections.Counter)
    for f, ss in _summ.items():
        for s in ss:
            allconf[s["confidence"]] += 1
            bykind[s["kind"]][s["confidence"]] += 1
    print(f"게이트 confidence 분포: {dict(allconf)}")
    for k, c in bykind.items():
        print(f"  {k:6} {dict(c)}")

    # 비용(bedrock)
    cost = None
    if backend == "bedrock" and _usage:
        tin = sum(u.get("input_tokens", 0) for u in _usage)
        tout = sum(u.get("output_tokens", 0) for u in _usage)
        p_in = float(os.environ.get("BEDROCK_VLM_PRICE_IN", "1.0"))   # $/1M in (가정 — 확인 필요)
        p_out = float(os.environ.get("BEDROCK_VLM_PRICE_OUT", "5.0"))  # $/1M out
        usd = tin / 1e6 * p_in + tout / 1e6 * p_out
        per_call = usd / len(_usage) if _usage else 0
        per_img = usd / len(SUBSET)
        cost = {"in_tok": tin, "out_tok": tout, "calls": len(_usage), "price_in": p_in, "price_out": p_out,
                "usd_total": round(usd, 4), "usd_per_call": round(per_call, 5), "usd_per_image": round(per_img, 5)}
        print("-" * 108)
        print(f"토큰: in={tin} out={tout} over {len(_usage)} calls")
        print(f"비용(@${p_in}/M in, ${p_out}/M out): total=${usd:.4f}  건당(call)=${per_call:.5f}  이미지당=${per_img:.5f}")

    out = os.environ.get("OUT")
    if out:
        summary = {
            "backend": backend, "model": model, "n_images": len(SUBSET),
            "acc_clear": [sum(r[4] for r in clear), len(clear)],
            "acc_amb": [sum(r[4] for r in amb), len(amb)],
            "acc_all": [sum(r[4] for r in rows), len(rows)],
            "by_group": {g: [sum(r[4] for r in rows if r[0].startswith(g)), len([r for r in rows if r[0].startswith(g)])] for g in ("hand", "face", "figure", "edge")},
            "calls": _metrics["calls"], "fail": _metrics["fail"], "errs": dict(_metrics["errs"]),
            "latency": {"mean": round(mean, 3), "p50": round(p50, 3), "max": round(lat[-1] if lat else 0, 3)},
            "parse": {"ok": _parse_stat["ok"], "none": _parse_stat["none"]},
            "gate_confidence": dict(allconf), "gate_by_kind": {k: dict(c) for k, c in bykind.items()},
            "cost": cost,
            "rows": [{"file": r[0], "clarity": r[1], "track": r[2], "pred": r[3], "hit": r[4], "acceptable": r[5], "gates": r[6]} for r in rows],
        }
        json.dump(summary, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"\n[written] {out}")


if __name__ == "__main__":
    run()
    print("\ndone")
