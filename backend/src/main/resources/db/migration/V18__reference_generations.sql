-- SCRUM-118: 레퍼런스 생성 대화 저장 — [프롬프트 → 생성이미지]를 이력으로 남겨 보드 진입 시 생성 채팅을 복원한다(가이드 채팅처럼).
CREATE TABLE reference_generations (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    prompt VARCHAR(500) NOT NULL,
    image_id BIGINT NOT NULL,
    url VARCHAR(1000) NULL,
    created_at TIMESTAMP(6) NOT NULL,
    KEY idx_refgen_project_user (project_id, user_id, created_at)
);
