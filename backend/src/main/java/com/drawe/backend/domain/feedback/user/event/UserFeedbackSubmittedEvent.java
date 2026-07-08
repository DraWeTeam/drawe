package com.drawe.backend.domain.feedback.user.event;

import java.time.Instant;

/**
 * 사용자 피드백이 DB에 커밋된 직후 발행되는 이벤트 — 팀 공용 메일 알림 트리거.
 *
 * <p>{@code UserFeedbackService.submit()} 트랜잭션이 commit 되면 {@code FeedbackMailService} 가 {@code
 * AFTER_COMMIT} 단계에서 받아 비동기로 메일을 발송한다. (AiImageCreatedEvent 와 동일 패턴.)
 *
 * <p>필요한 값은 전부 스냅샷으로 담아 전달한다 — 비동기 리스너가 DB(및 detached 엔티티)를 다시 건드리지 않게 하기 위함.
 */
public record UserFeedbackSubmittedEvent(
    Long id,
    Instant submittedAt,
    Long userId,
    String sessionId,
    Integer turnCount,
    String traceId,
    String body) {}
