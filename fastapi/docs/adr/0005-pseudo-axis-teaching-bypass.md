# 0005 — pseudo-axis: 진단 벽을 교습 카드로 우회

상태: 채택 (2026-07-01)

## 맥락

어떤 축은 신뢰할 만한 자동 진단이 불가능하거나 아직 안 빌드됐다 — 콘트라포스토·체형(silhouette)은
좌표·스코어가 실루엣/질량을 인코딩 못 하고(표현의 벽), 구도·빛은 게이팅 불가로 demote됐다([adacd12]).
그런데 작가가 "콘트라포스토가 뭐예요"라고 물으면 답해야 한다. "진단 못 하니 침묵"은 uselessness고,
"신뢰 없는 신호로 자동 발화"는 over-fire다([0003]). 진단 정확도와 **개념 교습**은 다른 요구다.

## 결정

- **pseudo-axis** — taxonomy에 `personas: []` · `auto: false` · SCORERS 없음으로 등록한 축. 자동 진단
  루프(persona 매칭)에는 **절대 안 뜨고**, 오직 `user_terms`(intake 키워드)로만 표면 = 개념 교습 카드 경로.
  발화는 판정이 아니라 정적 도식(`floor_svg`)+개념 설명. 스코어보드 byte-identical(진단 경로 무접촉).
- **크래시는 persona 부여가 아니라 *가드*로 고친다** — pseudo-axis가 user_terms로 표면될 때 레퍼런스
  검색 루프의 `persona_hint = tax[sp]["personas"][0]`가 빈 리스트에서 IndexError→500이 났다([b4b5787]).
  persona를 부여해 우회하면 auto 차단 의도가 깨지므로, 빈-리스트 가드(`personas[0] if personas else None`,
  검색은 None 허용·폴백)로 **personas:[] 의도(auto 차단)를 보존**한다.
- **톤은 "판정 아님·개념 안내"로 명시** — 체형은 "종류 나열" 금지→"실루엣 요소 조합", 콘트라포스토는
  weight_balance(균형 붕괴)와 다른 축임을 캡션에 못박는다.

## 기각한 대안

- **persona를 부여해 크래시 우회.** 기각: `personas`가 채워지면 persona-placeholder 경로로 auto 표면
  위험이 재개된다 — personas:[]의 존재 이유(자동 진단 차단)가 무너진다.
- **진단 못 하는 축은 카드 자체를 안 만든다(침묵).** 기각: 작가가 개념을 물으면 답해야 한다(uselessness).
  진단 불가 ≠ 교습 불가.
- **억지로 자동 진단 신호를 만든다.** 기각: 신뢰 없는 신호로 발화하면 over-fire·confabulation. "배선 ≠ 판정".

## 결과

- (+) 진단 벽 축(콘트라포스토·체형·동세·구도·빛)도 키워드 교습으로 커버하되 자동 진단 오염 0.
- (+) 크래시 가드가 정상 축(personas 있음)의 `[0]` 경로엔 무영향(무회귀) — 벽축 5개 200 + auto 차단 유지 실측.
- (−) 카드는 **정적 교습**(그림 기반 맞춤 판정 아님). 이 한계를 캡션이 명시적으로 인정한다.
- 교훈 사례: 격리검증(floor_svg 렌더·guide-asset 서빙)은 통과했으나 full /guide에서 500 — [0002] "배선≠판정" 표에 수록.

## 근거·관련

- 커밋: [4276626] 벽축 교습 카드 3종(pseudo-axis 신설), [b4b5787] 500 크래시 가드 + raw-id 라벨.
- 방법론: [0002](0002-accuracy-methodology.md)(이 크래시를 잡은 배선≠판정). over-fire 원칙: [0003](0003-abstain-over-fire-design.md).

[4276626]: 진단 불가(벽) 축 개념 교습 카드 3종 — light/contrapposto/body_shape
[b4b5787]: 벽축 pseudo-axis /guide 500 크래시 + raw axis-id 라벨 누출 핫픽스
[adacd12]: 비-인체 2단계 — composition·light_direction over-fire demote
