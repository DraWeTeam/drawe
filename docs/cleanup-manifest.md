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
| ~~A6~~ | `guide_id='cef90a83-6fa4-4a0b-b2fa-80660afbffe3'` (id 110) | README 데모 overlay 1마커 캡처 시도(미채택) | ✅ **삭제 완료(2026-07-07)** — guides id 110 DELETE(guide_feedback 0건). 동반 upload id 135는 `images` 테이블 부재(별도/기정리) |
| ~~★A7~~ | `guide_id='72a069f3-610f-4441-83ed-cb6b8cb76670'` (id 111) | README 데모 v1 원본(overlay 2마커) | **데모 v2(A9)로 교체 → 파이널 후보 아님.** 미사용화 — push 후 정리 가능(현 docs/demo 미참조) |
| ~~A8~~ | `guide_id='06256ec7-e592-4537-9e5e-2f32c420e639'` (id 113, upload 141) | demo v2 후보(무게중심 focus·overlay 2마커·persona_lean 확인용) | **미채택**(값 focus 37b4225c 채택) — push 후 삭제 |
| ★A9 | `guide_id='37b4225c-ac1f-476d-8008-66bbe146bb6c'` (id 114, upload 142, value_structure) | **README 데모 v2 원본**(§1~§7 full·§3 overlay 2마커·§4 추천이유+태그+**취향 결 뱃지**·persona_lean=[mood]) | **파이널 데모 확정 전 삭제 금지** — 현 docs/demo/guide.png·reason.png 원본. #54(mood 가시화) 실렌더 소스 |

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

## E. 재추천(guide-ref-reroll) 검증 생성물 (2026-07-07, 로컬 전용)

| # | 식별 방법 | 생성 목적 | 삭제 안전 확인 |
|---|---|---|---|
| E1 | `frontend/dist/` (vite 빌드 산출물) | 프론트 번들 검증(npm run build) | **gitignored** — 커밋 무관, 재빌드로 갱신. 삭제 무해 |
| E2 | `drawe-guide` 컨테이너 `/tmp/*.py`·`/tmp/poc/`(verify_tone·poc_*·verify_track1 하네스) | FastAPI /reroll·/guide 스모크 하네스 | 컨테이너 로컬 임시 — recreate 시 소멸. 삭제 무해 |
| E3 | 로컬 `drawe_guide` DB: /guide·톤 스모크가 남긴 `adoption_log`(event='shown')·`miss_log` 소량 | reroll 착수 전 검증 호출 부산물 | **로컬 docker 전용**(dev/prod 무관), 운영 로그성. reroll 자체는 DB 미기록(검색만). B 절차로 함께 정리 가능 |
| ★E4 | **Qdrant `reference_images_dev`**(dev 클라우드) `source_type='ai_example'` **3점**(현재 컬렉션 count 12720 = 기존 12717 + 3) | ④ 실브라우저 검증 중 value_structure 고갈→backfill 자가치유 생성물(qc_and_ingest, `ai_fallback.py:113`) | **dev 클라우드 코퍼스**(로컬 전용 아님). 정상 backfill 산출물이나 **테스트 트리거**. 삭제=선택(무해, `source_type='ai_example'` 필터로 조회 후 delete_by). prod(`reference_images_prod`)와 별개 컬렉션 |

주: 재추천 **엔드포인트 자체는 무상태·읽기전용**(DB 미기록). 단 ④ 검증에서 고갈 강제 도달이 **AI적격축 backfill을 트리거**해 dev Qdrant에 ai_example 3점이 생성됨(E4) — 유일한 영구 생성물. scratchpad 하네스(pw/·*.png)는 세션 임시(레포 밖).

## F. 무드 가시화(mood-match-visibility) 검증 생성물 (2026-07-07, 로컬)

| # | 식별 방법 | 생성 목적 | 삭제 안전 확인 |
|---|---|---|---|
| F1 | `drawe_db.guides` project_id=36, `guide_id='0a65872f-e202-46ef-a584-fd7e465ae6c1'`(user 1) | ④ mood_profile 필드 통과 + "취향 결" 뱃지 실렌더 검증(신규 coach 가이드) | 사용자 1 실 프로젝트 36의 검증 가이드. 삭제 무해(참조 `guide_feedback` 없음 확인 후). 동반 upload(image_blobs) 함께 정리 |
| F2 | scratchpad `pw/`(verify_mood2·verify2 등) + `*.png`(mood_set2 등) + `backend/build/` jar | playwright 무드/reroll 검증 하네스·스크린샷·빌드 | 세션 임시(레포 밖) / build gitignored. 삭제 무해 |

주: 무드 가시화는 **표시 전용**(스코어링·부스트 무변). F1은 fresh 가이드라야 `mood_profile` 필드가 담긴다(구 가이드 payload엔 미포함 → 프론트 폴백 정상=뱃지 0).
