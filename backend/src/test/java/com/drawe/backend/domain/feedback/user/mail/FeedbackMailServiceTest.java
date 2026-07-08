package com.drawe.backend.domain.feedback.user.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.drawe.backend.domain.feedback.user.event.UserFeedbackSubmittedEvent;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

/** FeedbackMailService 단위 테스트 — 메일 포맷(제목 프리픽스/키:값 본문)과 disabled 스킵 검증. */
class FeedbackMailServiceTest {

  private final JavaMailSender javaMailSender = mock(JavaMailSender.class);

  private static UserFeedbackSubmittedEvent event() {
    return new UserFeedbackSubmittedEvent(
        42L,
        Instant.parse("2026-07-08T05:30:00Z"), // KST 14:30
        7L,
        "sess-1",
        5,
        "trace-abc",
        "여러 줄에\n걸친 제법 긴 피드백 본문이라 제목 요약에서는 30자에서 잘려야 한다");
  }

  private FeedbackMailService service(boolean enabled, String to) {
    FeedbackMailProperties props = new FeedbackMailProperties();
    props.setEnabled(enabled);
    props.setTo(to);
    props.setFrom("noreply@drawe.xyz");
    return new FeedbackMailService(javaMailSender, props);
  }

  @Test
  @DisplayName("enabled=true — 제목 프리픽스 [DraWe-Feedback]와 고정 키:값 본문으로 발송한다")
  void sendsFormattedMailWhenEnabled() {
    service(true, "team-feedback@drawe.xyz").send(event());

    ArgumentCaptor<SimpleMailMessage> msg = ArgumentCaptor.forClass(SimpleMailMessage.class);
    verify(javaMailSender).send(msg.capture());
    SimpleMailMessage sent = msg.getValue();

    assertThat(sent.getTo()).containsExactly("team-feedback@drawe.xyz");
    assertThat(sent.getFrom()).isEqualTo("noreply@drawe.xyz");

    // 제목: [DraWe-Feedback] #42 | 2026-07-08 14:30 KST | {요약}…
    assertThat(sent.getSubject())
        .startsWith(FeedbackMailService.SUBJECT_PREFIX + " #42 | 2026-07-08 14:30 KST | ")
        .endsWith("…"); // 30자 초과라 말줄임
    assertThat(sent.getSubject()).doesNotContain("\n"); // 요약은 한 줄

    // 본문: 파싱 가능한 고정 키:값 + 구분선 아래 본문 전체
    String body = sent.getText();
    assertThat(body)
        .contains("feedback_id: 42")
        .contains("submitted_at: 2026-07-08 14:30:00 KST")
        .contains("user_id: 7")
        .contains("session_id: sess-1")
        .contains("turn_count: 5")
        .contains("trace_id: trace-abc")
        .contains("----")
        .contains("여러 줄에\n걸친 제법 긴 피드백 본문이라 제목 요약에서는 30자에서 잘려야 한다");
  }

  @Test
  @DisplayName("null 옵션 필드 — user_id/session_id/turn_count/trace_id 미상은 '-' 로 표기")
  void rendersDashForNulls() {
    UserFeedbackSubmittedEvent e =
        new UserFeedbackSubmittedEvent(
            1L, Instant.parse("2026-07-08T05:30:00Z"), null, null, null, null, "익명 피드백");

    service(true, "team-feedback@drawe.xyz").send(e);

    ArgumentCaptor<SimpleMailMessage> msg = ArgumentCaptor.forClass(SimpleMailMessage.class);
    verify(javaMailSender).send(msg.capture());
    String body = msg.getValue().getText();
    assertThat(body)
        .contains("user_id: -")
        .contains("session_id: -")
        .contains("turn_count: -")
        .contains("trace_id: -");
  }

  @Test
  @DisplayName("enabled=false — 발송을 건너뛴다(로컬/테스트 안전)")
  void skipsWhenDisabled() {
    service(false, "team-feedback@drawe.xyz").send(event());
    verify(javaMailSender, never()).send(any(SimpleMailMessage.class));
  }

  @Test
  @DisplayName("enabled=true 이지만 수신 주소 미설정 — 발송을 건너뛴다")
  void skipsWhenNoRecipient() {
    service(true, "  ").send(event());
    verify(javaMailSender, never()).send(any(SimpleMailMessage.class));
  }
}
