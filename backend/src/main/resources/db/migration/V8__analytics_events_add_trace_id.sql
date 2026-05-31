-- ============================================================
-- V8__analytics_events_add_trace_id.sql
-- ------------------------------------------------------------
-- 목적: analytics_events 에 trace_id 추가 — admin 대시보드(analytics) ↔
--       Tempo/Loki 의 조인 키. OTel Agent 가 요청 경계에서 MDC 에 주입한
--       trace_id 를 이벤트 적재 시 함께 저장한다 (AnalyticsEventService.doTrack).
--
--       nullable: 요청 컨텍스트 밖에서 적재되는 이벤트(스케줄러 · @Async
--       AFTER_COMMIT)와 OTel Agent 미적용 구간(과거치)은 NULL 로 남는다.
--
-- 형식: V7 로 analytics_events 가 Flyway 추적 하에 들어온 뒤의 forward 변경이므로
--       idempotent 가드 없이 clean 하게 작성한다 (V8+ 규칙).
--
-- 위치: drawe-backend/src/main/resources/db/migration/V8__analytics_events_add_trace_id.sql
-- ============================================================

ALTER TABLE `analytics_events`
    ADD COLUMN `trace_id` VARCHAR(32) NULL AFTER `session_id`;
