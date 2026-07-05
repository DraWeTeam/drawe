# 0003 — abstain / over-fire 설계: agree-or-abstain · 2-run · 낮음 게이트 · positive-only

상태: 채택 (2026-06-30)

## 맥락

VLM 관찰자([0001])는 측정이 아니라 가설이라, 단정하면 틀린다. 두 실패 모드가 신뢰를 깎는다:
**over-fire**(안 맞는데 발화 = confabulation)와 **over-abstain**(맞는데 침묵 = uselessness). 게다가
스타일별 노름(비례) 같은 곳에선 *약한-정답* 신호를 *확신-오답* 신호가 덮을 위험이 있다(figure_002 실측:
CLIP은 anime로 맞히고 VLM은 chibi로 틀렸다).

## 결정

- **agree-or-abstain** — 두 소스(예: CLIP·VLM)가 불일치하면 abstain. 약한 쪽을 확신-오답으로 덮지 않는다.
  단 명시 신호(사용자 track)가 있으면 즉시 발화(의도 존중).
- **2-run agree** — VLM 두 호출의 거친 축이 일치할 때만 'consistent'. 구조화 JSON으로 *기계적* 비교
  (자유 텍스트는 비교 불가).
- **낮음 게이트(abstain 바닥)** — "VLM도 모르면 모른다". 둘 다 불확실하거나 비대상(비-초상/비-전신)이면
  '낮음' → 보류. "일관된 무관찰"이 가짜 발화로 새는 경로를 막는다.
- **positive-only** — 관찰자는 *양성 성격*만 표면화한다(동적→action_line, 불안정→weight_balance). 정적·안정·
  중립엔 침묵. 결함 탐지는 측정 키포인트 스코어러 몫이다. 이게 over-fire 방지의 핵심 — 정적 포즈(chibi·normal)에
  거짓 발화 0.
- **매 변경 양쪽 가드** — over-fire(안 맞는 데 발화 0)와 over-abstain(맞는 데 표면화)을 둘 다 체크한다.

## 기각한 대안

- **"VLM이 더 확신하니 CLIP을 덮자."** 기각: figure_002에서 VLM(chibi) 확신-오답이 CLIP(anime) 약한-정답을
  덮으면 짧은다리 비례 결함을 가린다. **약한-정답 > 확신-오답.**
- **결함(negative)도 VLM이 발화.** 기각: 정적-결함(거의 직립 등)은 키포인트 스코어러 영역. VLM이 정적 포즈에
  발화하면 over-fire. positive-only가 그 경계다.
- **문턱을 낮춰 abstain 케이스를 살리기.** 기각: 골든 한 장 살리려 문턱을 내리면 over-fire 회귀. 게다가 abstain이
  *정답*인 케이스도 있다(치비에 비례 단정은 오조언 → 정답 abstain).

## 결과

- (+) confabulation(가짜 발화) 억제 = 신뢰 유지. 스타일 게이트 실측에서 측정된 over-fire 0건.
- (+) 정직한 침묵 — 모르면 모른다고 한다.
- (−) 골든에서 일부 정답을 abstain으로 놓친다(figure_002 auto = **설계된 손실**, 안전 비용). 명시 track에선 발화.
- 가드가 양방향이라 매 변경 비용이 2배다 — 그게 confabulation ↔ uselessness 사이 균형의 값이다.

## 근거·관련

- 측정: [stability_results.md](../stability_results.md)(관찰 안정성), [scored_baseline.md](../scored_baseline.md)(A/B/C/E delta).
  스타일 게이트 over-fire 0건은 `style_stability_results.md`(golden-set-kit).
- VLM 관찰자: [0001](0001-vlm-observer-pattern.md). 측정 방법론: [0002](0002-accuracy-methodology.md).
