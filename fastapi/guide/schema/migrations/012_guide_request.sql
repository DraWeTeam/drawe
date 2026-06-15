-- 012_guide_request.sql
-- request_id 멱등 — Spring 이 발급한 request_id 로 부작용(impressions/연습/관측 로그)을 at-most-once.
-- 재시도(같은 request_id)해도 practice_log/adoption_log 중복 집계를 막는다.
-- 응답 본문은 매번 새로 생성(LLM 비결정) — 보호 대상은 '부작용'뿐.
CREATE TABLE IF NOT EXISTS guide_request (
  request_id  VARCHAR(64) NOT NULL PRIMARY KEY,
  guide_id    CHAR(36),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
