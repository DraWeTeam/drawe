# 검증 데이터 정리 매니페스트

개발 국면 종료 시 **일괄 삭제**할 검증용 합성/테스트 데이터 목록. 삭제는 승인 후(★DELETE 규칙).
각 항목: **식별 방법 / 생성 목적 / 삭제 안전 확인**. **★ = 조건부 보류(아래 단서)**.

> ★**보류 단서**: **project 32 및 그 성장 이력(user 1·project 32 practice_log)은 D2 데모 확정 전까지 삭제 금지.** ⑦ 성장 그래프 시연에 쓰이는 유일한 8주 감소 이력이라, 데모 전 삭제 시 재구축 필요.

## A. 백엔드 가이드 (DB `drawe_db.guides`)

| # | 식별 방법 | 생성 목적 | 삭제 안전 확인 |
|---|---|---|---|
| A1 | `project_id=31 AND request_id LIKE 'synth-verify-%'` (id 66·67) | 합성 진단 응답 검증 | request_id 접두 'synth-verify-'는 검증 전용, 실사용 없음 |
| A2 | `project_id=31 AND request_id='realgen-verify-001'` (id 69) | 실 생성 파이프라인 검증 | 단일 고정 request_id |
| A3 | `project_id=31 AND request_id LIKE 'badge-verify-%'` (id 70·71) | ④ 추천 badge 3계층 검증 | request_id 접두 'badge-verify-' |
| A4 | `project_id=31 AND DATE(created_at)='2026-07-05'` (id 72·73, request_id=uuid) | ⑥ track 검증(value_flat_00·figure_003) | project 31의 2026-07-05 생성분 2건, uuid request_id |
| ★A5 | `project_id=32` (id 74, request_id=uuid) | ⑦ 성장 그래프 실렌더 | **D2 데모 확정 전 삭제 금지** |
| A6 | `project_id=31 AND guide_id='cef90a83-6fa4-4a0b-b2fa-80660afbffe3'` (id 110, 2026-07-06) | README 데모 overlay 1마커 캡처 시도(미채택) | 데모 캡처 **미사용** — **push 시점 삭제 예정**. 동반 upload(images 135) 함께 정리 |
| ★A7 | `project_id=31 AND guide_id='72a069f3-610f-4441-83ed-cb6b8cb76670'` (2026-07-06) | README 데모 4장 원본(§1~§7 full·그림 위 ①② overlay 2마커·추천 이유·태그) | **파이널 데모 확정 전 삭제 금지** — docs/demo/*.png 원본. 확정 후 동반 upload 함께 정리 |

연쇄: `guide_feedback` 에 위 guide id 참조행 있으면 함께(FK/수동). 삭제 전 `SELECT` 로 범위 확인.

## B. fastapi 성장 이력 (DB `drawe_guide.practice_log`)

| # | 식별 방법 | 생성 목적 | 삭제 안전 확인 |
|---|---|---|---|
| B1 | `user_id='growth_verify'` (project_id='gv1', guide_id LIKE 'gv-%', 40행/25 guide) | ⑦ 성장 로직 백엔드 단위검증 | **가짜 user·가짜 project** — 실사용과 완전 격리, 무조건 안전 |
| ★B2 | `user_id='1' AND project_id='32'` (guide_id LIKE 'g32-%' 합성 + 실 guide, 48행) | ⑦ 렌더용 합성 8주 감소 이력 | **project 32(A5)와 세트 — D2 데모 확정 전 삭제 금지** |

주의: user 1 의 **실사용 프로젝트(24 등)** practice_log 는 이 목록과 무관 — 절대 건드리지 말 것. 삭제는 `user_id`+`project_id` 로 범위를 반드시 한정.

## C. 백엔드 프로젝트 (DB `drawe_db.projects`)

| # | 식별 방법 | 생성 목적 | 삭제 안전 확인 |
|---|---|---|---|
| ★C1 | `name='growth verify'` (id 32, user 1) | ⑦ 성장 렌더용 신규 프로젝트 | **D2 데모 확정 전 삭제 금지**(A5·B2와 세트) |

## 일괄 삭제 절차(승인 후)
1. **먼저 `SELECT`** 로 각 식별 범위의 행 수를 확인(실사용 혼입 없음 검증).
2. 보류 해제 확인: **D2 데모 종료** 후에만 ★A5·B2·C1 삭제.
3. 순서: guide_feedback → guides → projects(백엔드) / practice_log(fastapi). UTF-8, 셸 미경유(파일/파라미터).
4. 비-보류분(A1~A4·B1)은 데모와 무관하므로 먼저 정리 가능.

## D. dev EKS 검증 데이터 (2026-07 bring-up)

| # | 식별 방법 | 생성 목적 | 삭제 안전 확인 |
|---|---|---|---|
| D1 | `drawe_db.guides` project_id=28, request_id=uuid (2026-07-05) — 가이드 `3a93a6c1-195c-4d75-9360-6e60872d40b6` 외 1건 | dev 실렌더 검증(사유·badge·track) | 사용자(id 5) 실 프로젝트 28의 검증 가이드. 삭제 무해 |
| D2 | `drawe_guide.practice_log` (dev RDS) `user_id='5' AND project_id='28' AND guide_id LIKE 'dev-w-%'` | ⑦ 주별 성장 차트 dev 렌더용 합성 6주 이력 | 합성 전용(guide_id 접두 'dev-w-'), 실사용과 격리 |

주: dev RDS는 로컬(drawe_guide docker)과 별개 인스턴스(drawe-dev-mysql). D2 삭제 시 범위 한정 필수. dev 013 마이그레이션(project_id 컬럼)은 **유지**(정본 스키마 정합 — 삭제 대상 아님).
