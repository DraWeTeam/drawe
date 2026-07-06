-- SCRUM-113: 레퍼런스 보드 마지막 검색어 저장 — 재진입 시 서버 기반 자동 복원(채팅처럼 로그아웃/디바이스 무관).
ALTER TABLE projects ADD COLUMN last_reference_query VARCHAR(500) NULL;
