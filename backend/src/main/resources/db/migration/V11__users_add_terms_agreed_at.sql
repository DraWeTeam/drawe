-- 회원가입 시 약관(이용약관/개인정보/만14세) 동의 시각 기록용 컬럼.
-- 필수 동의는 SignupRequest 의 @AssertTrue 로 가입 전 검증되며,
-- 여기에는 동의 시각만 감사(audit) 목적으로 저장한다. (가입 시 Instant.now())
-- nullable: OAuth/기존 유저 등 동의 시각이 없는 레코드 허용.
--
-- 멱등 처리: dev 는 ddl-auto=update 라 Hibernate 가 이미 컬럼을 만들었을 수 있다.
-- MySQL 은 "ADD COLUMN IF NOT EXISTS" 를 지원하지 않으므로 information_schema 로
-- 존재 여부를 확인한 뒤 동적 실행(V7 과 동일 패턴). 이미 있으면 no-op.

SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'terms_agreed_at'
);

SET @ddl := IF(
    @col_exists = 0,
    'ALTER TABLE users ADD COLUMN `terms_agreed_at` datetime(6) NULL AFTER `created_at`',
    'SELECT 1'  -- 이미 있으면 no-op
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;