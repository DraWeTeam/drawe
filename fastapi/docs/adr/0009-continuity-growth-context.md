# 0009 — 연속성 아키텍처: growth_context 기반 개인화된 이력 반영

상태: 채택 (2026-07-02 기록 · 최초 도입 [380684f])

## 맥락

매 /guide 요청이 독립이면 작가는 "혼자 그리는 느낌"이고 대화가 성립하지 않는다. 이력을 이어받는 것은
UX 핵심 요구다(사용자 확인: "이전 가이딩을 기억하고 이어가는 느낌"). 순진한 방법 — 이전 대화를 LLM으로
요약해 컨텍스트에 주입 — 은 **비정형 요약이라 손실적**이고 검증이 어려우며 매 요청 프롬프트를 부풀린다.
"몇 번째 그림에서 명암이 몇 번 걸렸나" 같은 궤적은 숫자로 정확히 남겨야 한다.

## 결정

이력을 **구조화 상태**로 두고 3층으로 반영한다:

- **practice_log(DB persist)** — 사용자별 축 이벤트(seen/tried)를 구조화 누적. 세션이 아니라 프로젝트
  단위로 영속되어 장기 성장 궤적을 만든다.
- **growth_context를 진단 *전*에 호출**([routes.py:110]) — 넛지로 축 순위에 이력을 반영한다:
  `STEADY_DEMOTE 0.12`(안정 축 뒤로) · `RECUR_PROMOTE 0.08`(재발 축 앞으로) · `FOCUS_PROMOTE 0.05`
  ([diagnose.py:735-737]). 진단 전이라 순위와 발화 양쪽이 개인화된다.
- **발화 지시로 문구에 엮기** — `recurred=true` 관찰은 "지난번에도 함께 봤던 부분"처럼 이어지게([prompts.py:88]),
  개선된 축은 "예전보다 안정적"으로 인정. 순위만이 아니라 *말*에 연속성이 실린다.
- **콜드스타트 개인화**([routes.py:123] `apply_cold_start`) — 이력 0인 첫 그림도 그 그림의 measured 약점으로
  포커스를 잡는다. 첫 발화부터 개인화(빈 시작 아님).
- **응답→프론트 영속** — `Growth` 스키마([schemas.py:70])로 성장 흐름이 프론트에 도달하고, guide 객체를
  채팅 메시지에 통째로 저장·복원([ChatPage.jsx:154],[ChatPage.jsx:324])해 스크롤 시 이전 가이딩이 유지된다.

## 기각한 대안

- **LLM 대화 압축**(이전 대화를 요약해 컨텍스트 주입). 기각: 비정형 요약은 손실적(숫자 궤적이 뭉개짐)이고
  검증이 어렵고 매 요청 프롬프트가 커진다. 구조화 이력이 압축 손실 0으로 이를 대체한다.
- **무상태**(매 요청 독립). 기각: 대화가 아니고 이력 반영 0 — UX 핵심 요구 위반.
- **세션 스코프만**(DB 없이 인메모리). 기각: 새로고침 시 소실, 장기 성장 궤적 불가. 영속이 필요하다.

## 결과

- (+) 구조화 이력이라 **압축 손실 0**(recurring 횟수·delta가 정확).
- (+) 진단 *전* 반영이라 순위와 발화가 함께 개인화. 채팅 영속으로 스크롤 시 이전 가이딩 유지.
- (+) **검증 가능**했다(2026-07 실측): recurring_stat이 매 턴 점화(turn2~5), delta "3개→1개로 줄었어요"
  실현, improved synthesis "예전보다 안정적" 4/4. (수치는 세션 실측 — 아래 근거 참조.)
- (−) DB 스키마·practice_log 관리 복잡도.
- (−) growth_context 호출이 매 /guide에 필수다(개인화라 캐시 불가 — [0008] 참조).
- (−) **★표시 갭:** 연속성이 *발화 문구*엔 엮이지만 **UI 채팅 스크롤 레벨엔 표면화가 미비**하다(성장 패널·
  narration이 상세 모달 안에 묻힘). 이건 발화 로직이 아니라 UI 조정 대상 — UI 트랙에서 다룬다([0002]
  검증표와는 별개의 UX 이슈).

## 근거·관련

- 최초 도입 커밋: [380684f](growth_context·practice_log·recurred 연속성 지시가 모두 이 커밋에서 등장 —
  `git log -S`로 확인). 현재 위치는 위 file:line.
- 실측: 연속발화·톤 실측(2026-07-02, 15발화)의 continuity 결과는 **세션 핸드오프/메모리에 기록**(스코어·
  진행상태는 ADR 밖 — [README](README.md) 방침). ※ scored_baseline.md·stability_results.md는 정확도
  A/B/C/E 측정이라 연속성 수치는 담고 있지 않다(혼동 방지 위해 명시).
- 이 순위 반영이 딛는 방법론: [0002](0002-accuracy-methodology.md). 개인화라 캐시 불가한 비용: [0008](0008-operating-cost-measured-noop.md).

[380684f]: feat(guide) fastapi image-guiding pipeline (연속성 3층의 최초 도입)
[routes.py:110]: growth_context() 진단 전 호출
[routes.py:123]: apply_cold_start() 이력 0 개인화
[diagnose.py:735-737]: STEADY_DEMOTE / RECUR_PROMOTE / FOCUS_PROMOTE 넛지
[prompts.py:88]: [연속성] recurred 발화 지시
[schemas.py:70]: class Growth (프론트 도달 스키마)
[ChatPage.jsx:154]: guide 객체 채팅 메시지 저장
[ChatPage.jsx:324]: 복원 시 guide 객체 통째 재구성
