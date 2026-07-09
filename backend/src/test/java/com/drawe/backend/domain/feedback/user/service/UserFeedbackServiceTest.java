package com.drawe.backend.domain.feedback.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.drawe.backend.domain.User;
import com.drawe.backend.domain.analytics.AnalyticsEventType;
import com.drawe.backend.domain.analytics.service.AnalyticsEventService;
import com.drawe.backend.domain.feedback.user.UserFeedback;
import com.drawe.backend.domain.feedback.user.dto.UserFeedbackRequest;
import com.drawe.backend.domain.feedback.user.dto.UserFeedbackResponse;
import com.drawe.backend.domain.feedback.user.event.UserFeedbackSubmittedEvent;
import com.drawe.backend.domain.feedback.user.repository.UserFeedbackRepository;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

/** UserFeedbackService 단위 테스트 — 저장·이벤트 적재·메일 트리거 이벤트 발행 검증. */
class UserFeedbackServiceTest {

  private final UserFeedbackRepository feedbackRepository = mock(UserFeedbackRepository.class);
  private final AnalyticsEventService analyticsEventService = mock(AnalyticsEventService.class);
  private final ApplicationEventPublisher eventPublisher = mock(ApplicationEventPublisher.class);

  private final UserFeedbackService service =
      new UserFeedbackService(feedbackRepository, analyticsEventService, eventPublisher);

  /** save() 시 DB가 id·created_at 을 채우는 것을 흉내 낸다. */
  private void stubSaveAssignsId(long id) {
    when(feedbackRepository.save(any(UserFeedback.class)))
        .thenAnswer(
            inv -> {
              UserFeedback f = inv.getArgument(0);
              f.setId(id);
              f.setCreatedAt(Instant.parse("2026-07-08T05:30:00Z"));
              return f;
            });
  }

  @Test
  @DisplayName("제출 — 저장 + FEEDBACK_SUBMITTED 이벤트 적재(turn_count/body_length) + 메일 이벤트 발행")
  void submitPersistsTracksAndPublishes() {
    stubSaveAssignsId(42L);
    User user = User.builder().id(7L).build();
    UserFeedbackRequest request = new UserFeedbackRequest("정말 유용했어요!", 5, "sess-1");

    UserFeedbackResponse response = service.submit(user, request);

    assertThat(response.id()).isEqualTo(42L);

    // 저장 엔티티 필드 매핑 검증
    ArgumentCaptor<UserFeedback> saved = ArgumentCaptor.forClass(UserFeedback.class);
    verify(feedbackRepository).save(saved.capture());
    assertThat(saved.getValue().getUserId()).isEqualTo(7L);
    assertThat(saved.getValue().getSessionId()).isEqualTo("sess-1");
    assertThat(saved.getValue().getBody()).isEqualTo("정말 유용했어요!");
    assertThat(saved.getValue().getTurnCount()).isEqualTo(5);

    // FEEDBACK_SUBMITTED analytics 적재 검증 (payload: turn_count, body_length)
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(analyticsEventService)
        .track(eq(AnalyticsEventType.FEEDBACK_SUBMITTED), eq(7L), eq("sess-1"), payload.capture());
    assertThat(payload.getValue())
        .containsEntry("turn_count", 5)
        .containsEntry("body_length", "정말 유용했어요!".length());

    // 커밋 후 메일 발송용 이벤트 발행 검증
    ArgumentCaptor<UserFeedbackSubmittedEvent> event =
        ArgumentCaptor.forClass(UserFeedbackSubmittedEvent.class);
    verify(eventPublisher).publishEvent(event.capture());
    assertThat(event.getValue().id()).isEqualTo(42L);
    assertThat(event.getValue().userId()).isEqualTo(7L);
    assertThat(event.getValue().turnCount()).isEqualTo(5);
    assertThat(event.getValue().body()).isEqualTo("정말 유용했어요!");
  }

  @Test
  @DisplayName("제출 — turnCount/sessionId 가 null 이어도 저장·적재·발행이 정상 동작한다")
  void submitAllowsNullOptionals() {
    stubSaveAssignsId(1L);
    User user = User.builder().id(9L).build();
    UserFeedbackRequest request = new UserFeedbackRequest("짧은 피드백", null, null);

    UserFeedbackResponse response = service.submit(user, request);

    assertThat(response.id()).isEqualTo(1L);
    verify(feedbackRepository).save(any(UserFeedback.class));
    verify(analyticsEventService)
        .track(eq(AnalyticsEventType.FEEDBACK_SUBMITTED), eq(9L), eq(null), any());
    verify(eventPublisher).publishEvent(any(UserFeedbackSubmittedEvent.class));
  }
}
