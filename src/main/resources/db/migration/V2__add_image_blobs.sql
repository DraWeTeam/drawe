-- 사용자 업로드 이미지(채팅 가이드용)를 DB BLOB으로 저장.
-- MVP 단계 한정: S3/Cloudinary로 옮길 때까지의 임시 저장소.
-- ImageStorage 인터페이스 뒤에 숨겨두어 나중에 구현체만 교체.
CREATE TABLE `image_blobs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `data` mediumblob NOT NULL,
  `mime_type` varchar(50) NOT NULL,
  `size_bytes` int NOT NULL,
  `user_id` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_image_blob_user_created` (`user_id`,`created_at`),
  CONSTRAINT `fk_image_blob_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
