-- SCRUM-120: 표지 원본 파일명·용량 저장(재진입 시 모달에 이름/크기 복원). 이미지 엔티티엔 원본 파일명이 없어 프로젝트에 함께 보관.
ALTER TABLE projects
  ADD COLUMN cover_image_name VARCHAR(255) NULL AFTER cover_image_url,
  ADD COLUMN cover_image_size BIGINT NULL AFTER cover_image_name;
