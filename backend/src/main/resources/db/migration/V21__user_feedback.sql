-- 사용자 자유서술 피드백 — 채팅 N턴 후 모달로 제출. DB가 원본(SoT), 팀 공용 메일은 알림 채널.
-- sentiment/category/category2/classified_by/classified_at 는 "향후" 어드민 분류용 컬럼으로,
-- 지금은 항상 NULL 로 적재된다(자동 감정 분류 없음). idx_feedback_unclassified 는 미분류(sentiment IS NULL)
-- 건을 최신순으로 훑는 어드민 분류 큐를 위한 선반영 인덱스.
CREATE TABLE user_feedback (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT       NULL,
    session_id    VARCHAR(64)  NULL,
    trace_id      VARCHAR(32)  NULL,
    body          TEXT         NOT NULL,
    turn_count    INT          NULL,
    sentiment     VARCHAR(16)  NULL,
    category      VARCHAR(32)  NULL,
    category2     VARCHAR(32)  NULL,
    classified_by VARCHAR(64)  NULL,
    classified_at TIMESTAMP    NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_feedback_created (created_at),
    KEY idx_feedback_unclassified (sentiment, created_at)
);
