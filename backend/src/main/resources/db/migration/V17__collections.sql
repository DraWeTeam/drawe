-- 아카이브 레퍼런스 "컬렉션" — 명명된 레퍼런스 그룹(SCR-ARCH-01~06).
-- 기존 project_references(프로젝트 종속 flat 구조)와 별개인 독립 계층.
--   · collections            : 유저 소유 컬렉션(이름/설명/태그). 사용자가 직접 만들고 관리하는 수동 컬렉션.
--   · collection_references  : 컬렉션 ↔ 이미지 매핑. pinned = 카드 고정하기. (collection_id, image_id) 유니크로 멱등.

CREATE TABLE `collections` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` tinytext,
  `tags` json DEFAULT NULL,
  `created_at` datetime(6) DEFAULT NULL,
  `updated_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_coll_user` (`user_id`),
  CONSTRAINT `fk_coll_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `collection_references` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `collection_id` bigint NOT NULL,
  `image_id` bigint NOT NULL,
  `pinned` bit(1) NOT NULL DEFAULT b'0',
  `added_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_collref_coll_image` (`collection_id`, `image_id`),
  KEY `idx_collref_image` (`image_id`),
  CONSTRAINT `fk_collref_collection` FOREIGN KEY (`collection_id`) REFERENCES `collections` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_collref_image` FOREIGN KEY (`image_id`) REFERENCES `images` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
