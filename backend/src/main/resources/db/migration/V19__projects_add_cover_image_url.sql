-- SCRUM-120: 프로젝트 표지 이미지(사용자 업로드). drawing_url(완성 그림·완성작 갤러리 게이트)과 의미 분리.
ALTER TABLE projects ADD COLUMN cover_image_url VARCHAR(500) NULL AFTER drawing_url;
