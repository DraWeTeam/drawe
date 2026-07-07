-- 013_practice_log_project.sql
-- growth(성장 흐름)를 프로젝트 단위로 스코프한다 — 크로스-프로젝트 이력 누출 차단.
-- 배경: growth 이력 쿼리가 전부 WHERE user_id 라, 한 유저가 여러 프로젝트를 오가면 새 프로젝트에도
--   다른 프로젝트의 추세·재발·개선이 합산돼 "가짜 이력"으로 보였다(같은 유저 3프로젝트 12업로드 실측).
-- Spring 이 /guide 호출 시 project_id(경로 변수 이미 보유)를 multipart 로 넘기고, roadmap.py 의
--   모든 practice_log SELECT 가 AND (:p IS NULL OR project_id = :p) 로 스코프한다.
-- 구 row(이 마이그레이션 이전)는 project_id = NULL → :p 지정 시 'project_id = :p' 가 NULL 이라
--   자연 제외 = "마이그레이션 이전 이력 미표시"(의도된 동작, 누출 0). backfill 은 하지 않는다
--   (guide_id→project 매핑은 백엔드 DB 라 cross-DB — 필요 시 별도 트랙).
ALTER TABLE practice_log ADD COLUMN project_id VARCHAR(64) NULL;
ALTER TABLE practice_log ADD INDEX idx_user_project_ts (user_id, project_id, ts);
