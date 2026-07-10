-- 레퍼런스 보드 검색 노출 로그 — 능동 수집(active curation) 퍼널의 anchor(shown).
-- 유저가 보드 상단 검색창으로 검색해 "실제로 보여진" 결과 카드의 image_id 를 한 행씩 남긴다.
--   · 기본 그리드 스크롤 노출은 제외(의도적 검색만 = 능동 수집 프레이밍).
--   · references_json(채팅 추천)·생성(images.source='AI')과 별개 경로. 이 테이블이 보드 세그먼트의 shown.
--   · image_id 에 FK 를 걸지 않는다: 고빈도 write + 코퍼스 이미지 삭제와 무관하게 노출 사실은 보존.
CREATE TABLE `reference_board_impressions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `image_id` bigint NOT NULL,
  `user_id` bigint DEFAULT NULL,
  `query` varchar(255) DEFAULT NULL,
  `source` varchar(20) DEFAULT NULL,
  `shown_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rbimp_image` (`image_id`),
  KEY `idx_rbimp_shown` (`shown_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
