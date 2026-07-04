# 스타일 자동분류 게이트 안정성 — 실측 (2026-06-30)

도구: `style_stability.py` (N=5, 반복 사이 VLM 캐시 flush). 게이트: `profiles._resolve_style`
(CLIP conf≥0.70 → 즉시; <0.70 → `classify_style` VLM 1회; agree→발화 / conflict·None→abstain).

| figure | truth style / axis | CLIP top·conf | band | VLM draws (N=5) | RESOLVE (발화/abstain) | 안정 |
|---|---|---|---|---|---|---|
| 001 | realistic / proportion | realistic **0.999** | 확신 | realistic×5 | realistic×5 (fire) | STABLE |
| 002 | **anime / proportion** | anime **0.563** ✅ | 에스컬 | **chibi×4, anime×1** | **None×5 (abstain)** | STABLE |
| 003 | realistic / weight_balance | realistic **0.561** ✅ | 에스컬 | anime×5 | None×5 (abstain) | STABLE |
| 004 | realistic / action_line | realistic 0.976 | 확신 | realistic×3,anime×2 | realistic×5 (fire) | STABLE |
| 005 | chibi / style_intentional(ambig) | chibi 0.991 | 확신 | chibi×5 | chibi×5 (fire) | STABLE |
| 006 | anime / color | anime 0.949 | 확신 | anime×5 | anime×5 (fire) | STABLE |

## 핵심 결론 (가설 반증)

1. **게이트는 불안정하지 않다.** 6장 전부 RESOLVE 가 N=5 내내 **STABLE**(같은 결과 5/5).
   "스타일 자동분류가 불안정해서 abstain" 가설은 **이 셋에서 재현 안 됨** — abstain 은 *흔들림*이 아니라
   *설계대로의 안정적 보류*다.

2. **CLIP top 은 6/6 정확** (저신뢰 002·003 포함). **불확실의 원인은 VLM**: 에스컬레이션 2케이스에서
   VLM 이 둘 다 틀림 — 002 를 chibi(정답 anime), 003 을 anime(정답 realistic). 확신케이스 004 도
   VLM 단독은 3:2 로 흔들림(단, CLIP≥0.70 이라 VLM 미consult → 무해).

3. **figure_002 = 설계된 손실.** CLIP 이 옳게 anime(0.563, 약)인데 VLM 이 확고히 chibi → agree-or-abstain
   이 **정확히 의도대로** 보류(약한-정답 CLIP 을 확신-오답 VLM 으로 덮지 않음). 게다가 chibi 로 발화했다면
   chibi norm(작은 몸 정상)이 켜져 **진짜 결함(짧은 다리=proportion)을 덮었을 것** → 보류가 옳다.
   recovery 는 (a) 약한 CLIP 단독 신뢰=문턱 내림(금지) 또는 (b) VLM 정확도 개선(골든 1장 fitting 위험) 뿐.

4. **over-fire(confabulation) 0건.** 발화 4장 모두 정답 스타일. 게이트는 보수적이고 정직하다.

## 함의

- 자동 경로에서 figure_002 proportion 카드 미발화는 *버그가 아니라* agree-or-abstain 안전비용.
  실측: `predict_axis(figure_002, track=None)` → **action_line**(proportion norm off → 다른 축),
  `track='anime_figure'` → **proportion** ✅. 프로덕션-충실 경로(명시 anime track)에서 ladder 카드는 이미 발화.
- 따라서 "안정성을 측정해 발화를 늘린다"의 전제(불안정)가 성립 안 함 → 게이트 완화는 부당(문턱 내림/overfit).
- 측정의 가치: 의심된 *불안정 버그*를 **측정된 비-버그**로 확정 → 미래에 누군가 게이트를 풀어
  confabulation 을 들이는 것을 차단. (= 측정 먼저, 추측 금지 규율의 정확한 사례)
