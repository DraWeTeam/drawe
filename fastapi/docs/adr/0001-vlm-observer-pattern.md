# 0001 — VLM 관찰자 패턴: MediaPipe 드로잉 한계를 순수 VLM 관찰로 보강

상태: 채택 (2026-06-30)

## 맥락

가이드 파이프라인은 인체 검출(MediaPipe: PoseLandmarker·FaceLandmarker·HandLandmarker)에서 키포인트를
얻어 축 신호(비율·무게중심·단축·손 구조 등)를 *측정*하도록 설계됐다. 그런데 MediaPipe는 **사진으로
학습**돼 해부도·선화 같은 드로잉에 약하다. 실측으로 확인:

- **BlazePose(전신):** 골든 figure 6장 중 **4장 미검출** — `status=skipped/no_person_detected`,
  keypoints=0. low_confidence(강등)도 _implausible_skeleton(자신있게 틀린 뼈대)도 아닌 **순수 미검출**
  (입력 자체가 안 들어옴). 근거: `pose_baseline_results.md`.
- **FaceLandmarker:** 드로잉 얼굴 **2/3** 검출(측면·스타일화 미검출).
- **HandLandmarker:** 드로잉 손에 약함(클로즈업도 자주 0).

→ `pose_reliability` 같은 **임계 튜닝으로는 못 살린다**. 강등할 스켈레톤이 없고, 입력이 0이다.
검출이 그림에 *장님*인 곳에선 다른 지각 소스가 필요하다.

## 결정

검출 복구가 아니라 **VLM(Gemini)을 '관찰자'로** 둔다. 핵심 분리: **측정=사실, 관찰=가설.**
VLM 출력은 측정 경로(SCORERS→measured_ids)가 아니라 placeholder로 주입돼 **`measured=False`**로
surface된다(프롬프트가 결핍을 단정하지 않고 가설형으로 안내). 셋이 동형 패턴:

| 함수 (`ml/vision.py`) | 게이트 | 캐시 ns | 관찰 필드 | diagnose 주입 |
|---|---|---|---|---|
| `observe_hand` | `HAND_VLM` | `hand` | view·plane·foreshortening·structure | `_vlm_hand_signal` |
| `observe_face` | `FACE_VLM` | `face` | is_portrait·view·eye_line | `_vlm_face_signal` |
| `observe_pose` | `POSE_VLM` | `pose` | is_full_body·dynamism·balance | `_vlm_pose_signal` |

공통 신뢰 장치(자유 텍스트는 비교 불가 → 구조화 JSON으로 *기계적* 일관성):
- **2-run agree:** 두 호출의 거친 축이 일치할 때만 'consistent'(아니면 '낮음'으로 보류).
- **신뢰 3단:** 관찰 / 관찰(약) / 낮음. 약은 단정 회피(보조 필드 미표기).
- **empty_obs 가드:** 관찰된 게 없으면('불확실' 일색, 또는 비-초상/비-전신) '낮음' → surface 안 함.
  ("일관된 무관찰"이 가짜 발화로 새는 경로 차단.)
- **FORBIDDEN 방어선:** coach 가드레일과 같은 어휘(실력·점수 등)가 새면 그 실행 폐기.

## 기각한 대안

- **하이브리드(landmark + VLM 합류).** landmark가 잡은 정면 케이스에 VLM을 더해 정밀도를 올리는 안.
  기각: 합류 로직은 **새 confabulation 진입로**인데, 정밀도 이득은 검출 성공 케이스(face 정면 1장)뿐 —
  레버리지가 안 맞는다. 검출이 통째로 0인 다수 케이스를 못 구한다.
- **검출 임계 튜닝(`pose_reliability` 완화).** 기각: 미검출은 강등이 아니라 0 입력이라 임계로 못 살림.
- **VLM으로 키포인트를 복원해 기존 스코어러에 먹이기.** 기각: 스코어러 트리거가 주제와 어긋난다 —
  예: `s_action_line`은 *정적-결함*(거의 직립)에 발화하는데 라벨은 *역동 포즈*에 동세를 주제로 기대.
  키포인트만 복원해도 안 맞는다. VLM은 결함 재현이 아니라 **포즈 성격(역동/균형)을 주제로 표면화**해야
  한다(positive-only — [0003] 참조).

## 결과

- (+) 드로잉 전신·얼굴·손 지각 확보 → **프로덕션 커버리지**(실사용 전신 ~2/3이 BlazePose 미검출). 측정/관찰
  분리로 신뢰 유지(가설이 '측정한 척' 안 샘), 동형 패턴이라 신규 축이 싸다(pose=face 복제로 land).
- (−) VLM 호출 비용·레이턴시(`observe_hand`만 2-run 병렬, face·pose는 순차 — 여지). 관찰은 가설이라
  단정 불가 → positive-only·abstain 바닥 필수([0003]).
- **골든 이득은 작고 진짜 가치는 프로덕션 커버리지** — 골든은 회귀 방지, 실효는 섀도우 측정·사람 평가가 비춘다.

## 근거·관련

- 측정: [pose_baseline_results.md](../pose_baseline_results.md)(pose 미검출 실측),
  [stability_results.md](../stability_results.md)(face 관찰 N=5 안정성).
- 평가 위생·single-change: [0002](0002-accuracy-methodology.md). positive-only·abstain/over-fire: [0003](0003-abstain-over-fire-design.md).
- `observe_hand`의 foreshortening 관찰 *필드를 어떻게 정의해 정의 붕괴를 막나*(자유 리스트→기하 binary·view 디커플): [0004](0004-latent-to-geometric-observable.md).
