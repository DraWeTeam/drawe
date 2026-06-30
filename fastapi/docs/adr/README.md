# 아키텍처 결정 기록 (ADR)

`fastapi/guide`(이미지 가이딩)의 **왜 이렇게 결정했나**를 남기는 곳. 코드는 *무엇을* 하는지 보여주지만,
기각한 대안·트레이드오프·전제는 코드에 안 남는다 — 그게 여기 들어간다.

## 무엇을 적나
- **결정과 그 이유**, 그리고 **기각한 대안**(이게 핵심 — 나중에 "왜 안 그랬지"를 막는다).
- 측정 근거가 있으면 `fastapi/docs/`의 측정 md를 **링크**한다(숫자를 ADR에 복붙하지 않음).

## 무엇을 안 적나
- **스코어·진행상태·로드맵**은 ADR에 안 넣는다 → 그건 세션 핸드오프/메모리 몫(시간 따라 변함).
  ADR은 *결정*이 바뀔 때만 바뀐다.

## 형식 (경량)
각 ADR: `NNNN-제목.md`, 상태(제안/채택/대체됨) · 맥락 · 결정 · 기각한 대안 · 결과(+/−). 한 결정 = 한 파일.
결정이 뒤집히면 새 ADR을 쓰고 옛 것의 상태를 "대체됨(→NNNN)"으로.

## 목록
- [0001](0001-vlm-observer-pattern.md) — VLM 관찰자 패턴 (MediaPipe 드로잉 한계 → 순수 VLM 관찰, measured=False)
- [0002](0002-accuracy-methodology.md) — 정확도 작업 방법론 (single-change isolation + 평가 위생)
- [0003](0003-abstain-over-fire-design.md) — abstain / over-fire 설계 (agree-or-abstain · 2-run · 낮음 게이트 · positive-only)
- [0004](0004-latent-to-geometric-observable.md) — latent→geometric observable (모호 관찰축을 기하 binary로 재정의 → 측정 정의 붕괴 해소 · view 디커플)

## 측정 근거 (이 디렉터리 `fastapi/docs/`)
ADR이 링크하는 측정 md — 숫자·delta·안정성 결과의 출처. ADR은 "왜"만, 숫자는 여기.
- [scored_baseline.md](../scored_baseline.md) — A/B/C/E before·after 전체.
- [stability_results.md](../stability_results.md) — N=5 반복 안정성(정확도≠안정성 분리).
- [pose_baseline_results.md](../pose_baseline_results.md) — D pose 미검출 실측(4/6).
