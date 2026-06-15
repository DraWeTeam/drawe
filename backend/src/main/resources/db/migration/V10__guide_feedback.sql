-- 가이드 전체 피드백(👍/👎) 수집. adoption_log(레퍼런스 "소비" 기록)와 분리 — 여기는 "이 가이드가
-- 유용했는가"만 본다. ImageFeedback 패턴을 그대로 따른다: enum('LIKE','DISLIKE') + @Enumerated(STRING),
-- 공용 FeedbackType 재사용. (user_id, guide_id) UNIQUE → 사용자별 1행(토글 시 갱신/해제).
-- 집계 예: SELECT feedback, COUNT(*) FROM guide_feedback WHERE guide_id=? GROUP BY feedback.
-- 기존 테이블/데이터 불변 — 새 테이블 생성만.
CREATE TABLE `guide_feedback` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `guide_id` bigint NOT NULL,
  `user_id` bigint DEFAULT NULL,
  `session_id` varchar(64) DEFAULT NULL,
  `feedback` enum('LIKE','DISLIKE') NOT NULL,
  `created_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_guide_feedback_user_guide` (`user_id`,`guide_id`),
  KEY `idx_guide_feedback_guide` (`guide_id`),
  CONSTRAINT `fk_guide_feedback_guide` FOREIGN KEY (`guide_id`) REFERENCES `guides` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_guide_feedback_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
