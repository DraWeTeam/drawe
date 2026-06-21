-- Unsplash 네이티브 AI 캡션(alt-text)을 images 에 추가.
-- LLM 이 레퍼런스/핀 이미지를 "픽셀 없이 태그로만" 설명하던 한계 → 할루시네이션(예: 없는 꽃 묘사) 보강용.
-- ai_description 은 실제 이미지 내용을 묘사하는 문장("grey kitten sitting on the doorway")이라
-- 태그 키워드보다 변별력이 크다. Unsplash 원본 photos.csv 의 ai_description 을 source_id 조인으로 백필(수동 1회).
-- AI(Bria) 이미지는 ai_description=NULL — 그쪽은 prompt 가 동일 역할(내용 문장)을 한다.
--
-- 멱등 처리: 로컬에서 docker 로 데이터를 먼저 적재하느라 컬럼을 수동 생성해 둘 수 있어, 이미 있으면 no-op.
-- (MySQL 은 ADD COLUMN IF NOT EXISTS 미지원 → information_schema 가드 + PREPARE 로 우회.)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'images' AND COLUMN_NAME = 'ai_description'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `images` ADD COLUMN `ai_description` text NULL AFTER `prompt`',
  'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;