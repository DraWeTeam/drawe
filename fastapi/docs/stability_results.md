# 안정성 검증 결과 (2026-06-29)

평가 위생 §3(반복으로 안정성 분포). 도구: `stability_eval.py`. 방법: 같은 이미지를 N=5회 *독립* 통과
(반복 사이 VLM 캐시 flush — L1 dict + valkey `vlm:*`. 단 한 번의 predict_axis *내부*는 캐시 살림 =
검출용·신호용 observe 가 한 draw-set 공유 = 프로덕션 충실). 환경: vertex gemini-2.5-flash, FACE/HAND/
SUBJECT/STYLE_VLM=1. 함정 회피: 캐시 안 끄면 2회차부터 전부 hit → '가짜 완벽 안정성'(캐시 결정성).

## 결론: E(face)의 +3은 진짜다(우연 1회 아님). hand 도 명확셋 안정적.

### FACE (E의 +3 검증 — 3장 × 5회, draw 30개)
| 이미지 | 최종축 | 라우팅 | is_portrait/view (draw 30) | eye_line | confidence/consistent |
|---|---|---|---|---|---|
| face_001 front | facial_proportion 5/5 | 얼굴/초상 5/5 | True 10/10, 정면 10/10 | 위 9 / 중앙 1 | 관찰 10/10, True 10/10 |
| face_002 profile | facial_proportion 5/5 | 얼굴/초상 5/5 | True 10/10, 측면 10/10 | 위 10/10 | 관찰 10/10, True 10/10 |
| face_003 3/4 | facial_proportion 5/5 | 얼굴/초상 5/5 | True 10/10, 3/4 10/10 | 위 10/10 | 관찰 10/10, True 10/10 |

라우팅을 가르는 필드(is_portrait·view)는 **30 draw 내내 한 번도 안 뒤집힘**. 흔들린 건 2차 필드 eye_line
하나(face_001 위9/중앙1)뿐 — 축에 영향 없음. → facial_proportion 15/15 rep. **+3 확정.**

### HAND (명확셋 안정·애매셋 보수)
| 이미지 | 최종축 | 라우팅 | view (draw) | structure (draw) | 비고 |
|---|---|---|---|---|---|
| hand_001 V-sign | hand_structure 5/5 (acc) | 손 5/5 | 손등 10/10 | 평면 9/입체 1 | 게이트는 view만 — 안정 |
| hand_002 palm | hand_structure 5/5 (acc) | 손 5/5 | (observe None) | — | 결정 신호로 라우팅, 축 안정 |
| hand_003 long fingers | hand_structure 5/5 (acc) | 손 5/5 | 손등 10/10 | 입체 9/평면 1 | proportion 아닌 hand_structure로(둘 다 acc) |
| hand_004 foreshortened | **None 5/5** | 인물(자동) 5/5 | (face관찰 不초상) | — | **애매 — 일관 보수(abstain)**. 손이 figure로 오라우팅 |
| hand_005 palm ratio | hand_structure 5/5 (acc) | 손 5/5 | 손바닥 10/10 | 입체 10/10 | 매우 안정 |

명확 hand 4장: view 40 draw 내내 안정(손등/손바닥 불변). structure 는 흔들리나 *설계상 게이트 제외*(_agree
view만). 애매 hand_004 는 confident 오답으로 깜빡이지 않고 **일관되게 None(보수)** — 안정성 관점 양호.

### 가드(over-fire/over-abstain) 반복 하에서도 유지
- face_003 의 부수적 observe_hand → 낮음/불확실 5/5: 얼굴에 가짜 hand_structure 안 냄(B 가드 작동).
- hand_004: confident 오답축 한 번도 안 만듦(애매를 애매로).

### 방법론 메모
§2 "호출마다 view 뒤집힘"은 **이 세트의 명확 이미지에서는 재현 안 됨**(현 vertex flash + runs=2 agree
게이트). 라우팅 필드는 안정. (게이트 포함 end-to-end 측정이며 raw per-draw 도 안정이었음.) 즉 현재 구성에서
명확셋 점수는 '시스템이 맞힘'이지 '우연히 맞는 자리에 떨어짐'이 아니다. hand_004 의 figure 오라우팅은
별개의 *라우팅* 결함(CLIP 이 단축된 손을 인물로 봄) — 안정적이지만 미해결(§3-4 후보).
