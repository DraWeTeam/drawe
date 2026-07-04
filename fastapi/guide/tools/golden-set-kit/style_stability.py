"""style_stability.py — 스타일 자동분류 게이트(_resolve_style)의 안정성 실측.

왜: proportion 카드가 발화하려면 인물(자동)에서 스타일 norm 이 켜져야 한다(_resolve_style != None).
CLIP 은 결정적이지만 conf<0.70 이면 VLM(classify_style) 1회로 에스컬레이션 — 이 VLM 이 호출마다
흔들리면 같은 그림이 발화↔abstain 을 오간다(= '맞는데 발화 안 함'의 불안정성). 그걸 측정한다.

측정(반복 사이 VLM 캐시 flush — 안 끄면 캐시 hit 으로 가짜 안정):
  - CLIP: style probs + top + conf (결정적, 1회면 충분)
  - VLM classify_style: N draw → 분포(흔들림)
  - _resolve_style 최종: N draw → 발화(style)↔abstain(None) 분포
블라인드 스타일 truth(labels.intended_tracks) 대비 정오 표기.

실행: docker exec -w /app -e PYTHONPATH=/app -e STYLE_VLM=1 drawe-guide \
        python guide/tools/golden-set-kit/style_stability.py
"""

import collections
import os

import numpy as np
from PIL import Image

import guide.cache as cache
from guide.ml.embed import embedder
from guide.ml.scene import _scores
from guide.pipeline import profiles

IMG_DIR = "/app/guide/tools/golden-set-kit/images"
N = 5

# 블라인드 스타일 truth (labels.json intended_tracks 의 *_figure 힌트).
TRUTH = {
    "figure_001_standing_front_normal.png": ("realistic", "proportion"),
    "figure_002_short_legs.png": ("anime", "proportion"),
    "figure_003_unbalanced_pose.png": ("realistic", "weight_balance"),
    "figure_004_walking_pose.png": ("realistic", "action_line"),
    "figure_005_sd_chibi.png": ("chibi", "style_intentional(ambiguous)"),
    "figure_006_message_color.png": ("anime", "color"),
}


def flush_vlm():
    cache._VLM_L1.clear()
    c = cache._client()
    if c is not None:
        try:
            for k in c.scan_iter("vlm:*"):
                c.delete(k)
        except Exception as e:
            print(f"[flush] valkey 삭제 실패(L1만): {type(e).__name__}: {e}")


def clip_style(pil):
    iv = embedder.image(pil)
    sc = _scores(iv, list(profiles._STYLE_LABELS.values()))
    keys = list(profiles._STYLE_LABELS.keys())
    probs = [sc[p] for p in profiles._STYLE_LABELS.values()]
    i = int(np.argmax(probs))
    return (
        keys[i],
        float(probs[i]),
        {k: round(sc[v], 3) for k, v in profiles._STYLE_LABELS.items()},
    )


def main():
    print(
        f"STYLE_VLM={os.environ.get('STYLE_VLM')}  _STYLE_HIGH={profiles._STYLE_HIGH}  N={N}"
    )
    print("=" * 100)
    from guide.ml.vision import classify_style

    for fn, (truth_style, axis) in TRUTH.items():
        p = os.path.join(IMG_DIR, fn)
        if not os.path.exists(p):
            print(f"{fn}: (없음)")
            continue
        pil = Image.open(p).convert("RGB")
        ctop, cconf, cprobs = clip_style(pil)
        band = (
            "CLIP확신(>=0.70)"
            if cconf >= profiles._STYLE_HIGH
            else "에스컬레이션(<0.70)"
        )

        vlm_draws, resolve_draws = [], []
        for _ in range(N):
            flush_vlm()
            vlm_draws.append(classify_style(pil))
            flush_vlm()
            resolve_draws.append(profiles._resolve_style(pil))

        vc = collections.Counter(str(x) for x in vlm_draws)
        rc = collections.Counter(str(x) for x in resolve_draws)
        fired = sum(1 for x in resolve_draws if x is not None)
        stable = "STABLE" if len(rc) == 1 else "FLIP"
        ok_mark = "OK" if ctop == truth_style else "X "
        print(f"\n{fn}")
        print(f"  truth: style={truth_style:10s} axis={axis}")
        print(
            f"  CLIP : top={ctop:10s} conf={cconf:.3f}  [{band}] {ok_mark} probs={cprobs}"
        )
        print(f"  VLM   draws (N={N}): {dict(vc)}")
        print(
            f"  RESOLVE draws (발화/abstain): {dict(rc)}  fired={fired}/{N}  -> {stable}"
        )
    print("\n" + "=" * 100 + "\ndone")


if __name__ == "__main__":
    main()
