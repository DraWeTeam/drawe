# D(드로잉 pose) — 기준선 실측 (2026-06-30)

도구 `pose_probe.py`(컨테이너 실행, 전 골든셋 pose 상태 + auto 1차축 덤프). 본 문서는 D의 *측정된*
출발점이다 — VLM pose 설계/도입 전 "무엇이·왜 막혔나"를 가설 아닌 데이터로 못박는다.

## 1. figure track pose 검출 실측 (6장)

| file | exp_primary(라벨) | pose status | tier | 가시 kp | auto 1차축 | clarity |
|---|---|---|---|---|---|---|
| figure_001_standing_front_normal | proportion | skipped/no_person | **fail** | 0 | **None** | clear |
| figure_002_short_legs | proportion | ok | ok | 33 | action_line | clear |
| figure_003_unbalanced_pose | weight_balance | ok | ok | 33 | **weight_balance ✓** | clear |
| figure_004_walking_pose | action_line | skipped/no_person | **fail** | 0 | **None** | clear |
| figure_005_sd_chibi | style_intentional | skipped/no_person | **fail** | 0 | None(≈abstain) | ambiguous |
| figure_006_message_color | color | skipped/no_person | **fail** | 0 | hand_structure | clear |

**검출 2/6 OK(002·003), 4/6 FAIL(001·004·005·006).** handoff "BlazePose 4/6 미검출" 재현·확정.

## 2. 핵심 사실 (측정으로 확정)

1. **실패 모드 = 순수 미검출, 퇴화 스켈레톤 아님.** 4장 전부 `status=skipped, reason=no_person_detected`,
   keypoints=0. low_confidence(강등)도 _implausible_skeleton(자신있게 틀린 뼈대)도 아니다 —
   mediapipe PoseLandmarker(사진 학습)가 해부도/선화 인물에 **아예 응답 안 함**. → pose_reliability
   튜닝(임계 조정)으로는 절대 못 살림. 입력 자체가 안 들어옴 = 다른 지각 소스 필요(VLM).

2. **검출되면 파이프라인은 동작한다.** figure_003: com_offset=4.01 측정 → weight_balance ✓(정답).
   즉 D는 "pose→축 배선"이 깨진 게 아니라 "pose 신호가 안 들어오는" 문제. 배선은 멀쩡.

3. **★ pose 축은 *결함 탐지기*인데 라벨은 *주제*를 기대 — D는 검출만의 문제가 아니다.**
   `s_action_line`은 `torso_lean < 0.03`(거의 직립=너무 뻣뻣)일 때 발화하는 **정적-결함 탐지기**다.
   실측: figure_003(역동, lean=0.179)은 action_line 미발화(weight_balance가 리드). 그런데 라벨은
   **figure_004(걷는 역동 포즈)에 action_line을 기대**한다 — "뻣뻣해서"가 아니라 "역동 포즈의 교습
   주제 = 액션 라인을 의식하라". **트리거가 정반대.** 따라서 mediapipe 키포인트를 VLM으로 복원해
   기존 스코어러에 먹여도 figure_004는 action_line이 안 나온다. VLM pose는 *결함 재현*이 아니라
   *포즈 성격(역동/균형)을 주제로 표면화*해야 한다. = 설계 문제.

4. **figure_002 = pose 무관(스타일 게이트 손실).** pose OK인데 auto=action_line(proportion 아님):
   leg_torso=0.80은 anime 밴드(0.9~2.3) 밖이라 proportion이 *발화 가능*하나, CLIP anime↔VLM chibi
   불일치로 norm OFF(abstain) → proportion 미발화, torso_lean 0.001로 action_line이 대신 점령.
   이건 [[style_stability_results]]가 확정한 *설계된 손실*. **D가 건드릴 대상 아님.**

5. **figure_006 = pose 무관(메시지 라우팅).** 기대 color는 "색 메시지"에 응답하는 축. auto는
   subject가 hand로 오분류돼 hand_structure 발화. pose와 무관 — D가 직접 못 고침.

## 3. D의 *정직한* 골든셋 레버리지 (과대평가 금지)

명확셋 6 figure 중 pose-fail로 *깨끗이* 막힌 축:
- **figure_004 (action_line, clear)** — 역동 포즈를 VLM이 "동적"으로 관찰→action_line 주제 표면화 시
  복구 가능. **D의 가장 깨끗한 +1.**
- figure_001 (proportion, clear) — "normal control, 심한 결함 없음"(라벨). proportion은 결함이 아니라
  figure 커리큘럼 리드일 뿐. VLM pose가 proportion을 *주장*하면 안 됨(스타일 얽힘, §4 재개방).
  → 약한 타깃, D 설계에서 **proportion은 VLM 비대상으로 두면 figure_001은 None 유지(허용)**.
- figure_005 (chibi, ambiguous) — None≈abstain이 *정답*(치비에 proportion 발화는 오조언). VLM pose가
  여기서 action_line/weight_balance를 **over-fire 하면 회귀**. → 정적/중립 포즈엔 침묵해야(positive-only).

**결론: 이 15장 골든셋에서 D의 깨끗한 점수 이득은 figure_004 한 장(+1)에 가깝다.** 나머지 figure 미스는
스타일 게이트(002)·메시지 라우팅(006)·정답 abstain(005)·약한 타깃(001)이라 D 밖이거나 D가 건드리면
손해다. **D의 진짜 가치는 골든 점수가 아니라 프로덕션 커버리지** — 실사용자 전신 드로잉의 ~2/3을
BlazePose가 놓치는데(실측 4/6), 그 입력에 포즈 기반 가이드(역동/균형/단축)를 줄 지각이 지금 0이다.

## 4. 설계 방향 (다음 세션 구현 — observe_hand/face 패턴 이식)

`observe_pose`(vision.py) → `_vlm_pose_signal`(diagnose.py) 주입, **measured=False(관찰=가설)**:
- 게이트: `is_full_body`(is_portrait 동형) — 전신/부분 인물일 때만. 얼굴·사물엔 침묵.
- 2-run agree + 신뢰 3단(관찰/관찰약/낮음) + empty_obs 가드(전부 불확실→낮음).
- **style-invariant 성격만 관찰, positive-only 발화**:
  - `dynamism`: 동적(움직임/걷기/달리기) → **action_line 주제** 표면화. 정적·직립이면 **침묵**
    (정적-결함은 기존 키포인트 스코어러 영역; VLM이 chibi/normal에 over-fire 방지).
  - `balance`: 한발 지지·뚜렷한 기울임으로 불안정 → **weight_balance 주제**. 안정이면 침묵.
- **proportion은 VLM 비대상**(스타일 얽힘 재개방 금지 — 측정 키포인트+밴드 경로 유지).
- diagnose 게이트 수정: `tier!=POSE_OK and sid in POSE_DEPENDENT` continue(715행)에 **VLM 관찰자 보유
  축(action_line·weight_balance) 예외** 추가 — hand_structure/facial_proportion이 이미 받는 것과 동형.
  단 관찰자가 confident일 때만(None이면 기존대로 억제).

가드(매 변경 양쪽 체크): over-fire = figure_005(chibi)·001(normal)에 거짓 발화 0 / over-abstain =
figure_004 action_line 표면화. before-after는 track_aware_eval + pose_probe 재실행.

도구: `pose_probe.py`. 환경: vertex VLM, 캐시 ns `pose` flush 시 `vlm:pose:*`.
