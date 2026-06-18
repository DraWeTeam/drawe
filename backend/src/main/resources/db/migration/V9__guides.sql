-- 이미지 가이딩 결과(한 끗 가이드) 영속. 사용자 대면 "지난 가이드"·PDF·레퍼런스 재방문의 근거.
-- payload = FastAPI /guide 응답(GuideResponse) 전체 JSON. reference_ids 형태로 보관(만료 URL 미저장).
-- request_id = Spring 발급 멱등 키(재시도 시 at-most-once 영속, UNIQUE 로 보장).
-- 기존 테이블/데이터 불변 — 새 테이블 생성만.
CREATE TABLE `guides` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `request_id` varchar(64) NOT NULL,
  `guide_id` varchar(64) DEFAULT NULL,
  `user_id` bigint NOT NULL,
  `project_id` bigint NOT NULL,
  `upload_id` bigint DEFAULT NULL,
  `primary_focus` varchar(64) DEFAULT NULL,
  `degraded` bit(1) NOT NULL DEFAULT b'0',
  `payload` json NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_guides_request_id` (`request_id`),
  KEY `idx_guides_user_project_created` (`user_id`,`project_id`,`created_at`),
  KEY `idx_guides_guide_id` (`guide_id`),
  CONSTRAINT `fk_guides_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_guides_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_guides_upload` FOREIGN KEY (`upload_id`) REFERENCES `image_blobs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
