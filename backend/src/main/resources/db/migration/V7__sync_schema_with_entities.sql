-- ============================================================
-- V7__sync_schema_with_entities.sql
-- ------------------------------------------------------------
-- 목적: 엔티티(:10 코드)가 요구하지만 V1~V6 에 없던 스키마를
--       Flyway 로 정식 기록한다.
--
-- 중요: prod / dev 에는 이미 이 변경들이 "손으로" 적용돼 있다.
--       그래서 이 마이그레이션은 **idempotent**(이미 있어도 에러 없이 통과)
--       하게 작성했다. 다음 배포 때 Flyway 가 V7 을 실행해도 깨지지 않고,
--       flyway_schema_history 에 V7 이 기록되며 정합성이 맞춰진다.
--       신규/로컬 DB 에서는 V1~V6 위에 실제로 생성/변경된다.
--
-- 위치: drawe-backend/src/main/resources/db/migration/V7__sync_schema_with_entities.sql
-- ============================================================


-- ── 1. analytics_events 테이블 ──────────────────────────────
-- 없으면 생성, 있으면 통째로 skip (CREATE TABLE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS analytics_events (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    created_at  DATETIME(6)  NOT NULL,
    event_type  VARCHAR(50)  NOT NULL,
    payload     JSON         NULL,
    session_id  VARCHAR(64)  NULL,
    user_id     BIGINT       NULL,
    PRIMARY KEY (id),
    KEY idx_event_user_time (user_id, created_at),
    KEY idx_event_session   (session_id),
    KEY idx_event_type_time (event_type, created_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;


-- ── 2. projects.pinned_image_ids 컬럼 ───────────────────────
-- MySQL 은 "ADD COLUMN IF NOT EXISTS" 를 지원하지 않으므로,
-- information_schema 로 존재 여부를 확인한 뒤 동적 실행(가드).
--
-- ⚠️ 타입을 반드시 확인하고 맞추세요. 아래는 JSON 으로 가정한 예시입니다.
--    prod 에서:  SHOW COLUMNS FROM projects LIKE 'pinned_image_ids';
--    그 Type 과 아래 'ALTER ... ADD COLUMN pinned_image_ids <타입>' 을 일치시킬 것.
SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'projects'
      AND COLUMN_NAME  = 'pinned_image_ids'
);

SET @ddl := IF(
    @col_exists = 0,
    'ALTER TABLE projects ADD COLUMN pinned_image_ids JSON NULL',  -- ← 타입 확인/수정
    'SELECT 1'                                                     -- 이미 있으면 no-op
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ── 3. prompt_translation_logs.status : VARCHAR -> ENUM ─────
-- MODIFY 는 동일 타입에 다시 적용해도 무해(idempotent).
-- 신규 DB(V1~V6에서 varchar로 생성)에서는 enum 으로 변경되고,
-- 이미 enum 인 prod 에서는 사실상 no-op.
ALTER TABLE prompt_translation_logs
    MODIFY COLUMN status ENUM('SUCCESS', 'FALLBACK_RAW', 'FAILED') NOT NULL;
