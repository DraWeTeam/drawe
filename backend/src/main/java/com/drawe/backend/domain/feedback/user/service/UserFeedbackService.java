package com.drawe.backend.domain.feedback.user.service;

import com.drawe.backend.domain.User;
import com.drawe.backend.domain.analytics.AnalyticsEventType;
import com.drawe.backend.domain.analytics.service.AnalyticsEventService;
import com.drawe.backend.domain.feedback.user.UserFeedback;
import com.drawe.backend.domain.feedback.user.dto.UserFeedbackRequest;
import com.drawe.backend.domain.feedback.user.dto.UserFeedbackResponse;
import com.drawe.backend.domain.feedback.user.event.UserFeedbackSubmittedEvent;
import com.drawe.backend.domain.feedback.user.repository.UserFeedbackRepository;
import java.util.HashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 사용자 자유서술 피드백 수집.
 *
 * <p>한 번의 {@link #submit} 이 세 가지를 한다:
 *
 * <ol>
 *   <li>user_feedback insert (원본 = SoT)
 *   <li>{@link AnalyticsEventType#FEEDBACK_SUBMITTED} analytics 이벤트 적재 (funnel 분석용)
 *   <li>커밋 후 팀 공용 메일 발송 트리거 ({@link UserFeedbackSubmittedEvent} 발행 → AFTER_COMMIT 비동기)
 * </ol>
 *
 * <p>남용 방지(사용자당/세션당 제한)는 프론트가 제어한다 — 백엔드 저장은 항상 허용.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserFeedbackService {

  private final UserFeedbackRepository feedbackRepository;
  private final AnalyticsEventService analyticsEventService;
  private final ApplicationEventPublisher eventPublisher;

  @Transactional
  public UserFeedbackResponse submit(User user, UserFeedbackRequest request) {
    Long userId = user != null ? user.getId() : null;
    // AnalyticsEvent 적재와 동일한 소스 — OTel Agent 가 요청 경계에서 MDC 에 주입한 trace_id.
    String traceId = MDC.get("trace_id");

    UserFeedback feedback = new UserFeedback();
    feedback.setUserId(userId);
    feedback.setSessionId(request.sessionId());
    feedback.setTraceId(traceId);
    feedback.setBody(request.body());
    feedback.setTurnCount(request.turnCount());
    feedbackRepository.save(feedback); // IDENTITY → 즉시 flush, id·created_at 확정

    // ② funnel 이벤트. 원문은 PII 라 body 는 길이만 payload 에.
    Map<String, Object> payload = new HashMap<>();
    payload.put("turn_count", request.turnCount());
    payload.put("body_length", request.body().length());
    analyticsEventService.track(
        AnalyticsEventType.FEEDBACK_SUBMITTED, userId, request.sessionId(), payload);

    // ③ 커밋 후 비동기 메일 — 값은 스냅샷으로 전달(detached 엔티티 재접근 회피).
    eventPublisher.publishEvent(
        new UserFeedbackSubmittedEvent(
            feedback.getId(),
            feedback.getCreatedAt(),
            userId,
            request.sessionId(),
            request.turnCount(),
            traceId,
            request.body()));

    log.info(
        "피드백 저장: feedback_id={}, user_id={}, turn_count={}",
        feedback.getId(),
        userId,
        request.turnCount());

    return new UserFeedbackResponse(feedback.getId());
  }
}
