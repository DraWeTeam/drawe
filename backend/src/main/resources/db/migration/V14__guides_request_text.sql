-- ============================================================
-- V14__guides_request_text.sql
-- ------------------------------------------------------------
-- 목적: guides 에 request_text 추가 — 사용자가 업로드와 함께 보낸 질문
--       (주황 말풍선). 새로고침 후 히스토리 복원 시 가이드 카드 앞에
--       사용자 발화를 재구성하기 위한 근거. payload(AI 응답 계약)는
--       사용자 입력을 담지 않으므로 요청 메타데이터로 별도 컬럼에 보관한다.
--
--       nullable: 질문 없이 이미지만 올린 경우와 이 컬럼 도입 전 과거
--       가이드는 NULL 로 남는다(프론트는 빈 값이면 말풍선 생략).
--
-- 형식: V9 로 guides 가 Flyway 추적 하에 들어온 뒤의 forward 변경이므로
--       idempotent 가드 없이 clean 하게 작성한다 (V8+ 규칙).
--
-- 위치: drawe-backend/src/main/resources/db/migration/V14__guides_request_text.sql
-- ============================================================

ALTER TABLE `guides`
    ADD COLUMN `request_text` TEXT NULL AFTER `degraded`;
