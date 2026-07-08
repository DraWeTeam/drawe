package com.drawe.backend.domain.feedback.user.mail;

import com.drawe.backend.domain.feedback.user.event.UserFeedbackSubmittedEvent;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 사용자 피드백 → 팀 공용 메일 알림.
 *
 * <p>DB(user_feedback)가 원본이고 메일은 알림 채널이므로:
 *
 * <ul>
 *   <li>{@code drawe.feedback.mail.enabled=false}(기본)거나 수신 주소 미설정이면 발송을 건너뛰고 info/warn 로그만 남긴다 —
 *       로컬/테스트에서 안전.
 *   <li>발송 실패는 error 로그만 남기고 재시도하지 않는다 — 원본은 이미 DB에 있다.
 * </ul>
 *
 * <p>{@link TransactionalEventListener}(AFTER_COMMIT) + {@link Async} 로 커밋 후 비동기 발송 — 사용자 응답을 SMTP
 * 왕복만큼 늦추지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FeedbackMailService {

  /** 공용 메일함에서 이 프리픽스로 필터/라벨 분류한다. 절대 변경 주의. */
  public static final String SUBJECT_PREFIX = "[DraWe-Feedback]";

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter SUBJECT_TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(KST);
  private static final DateTimeFormatter BODY_TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(KST);
  private static final int SNIPPET_LEN = 30;

  private final JavaMailSender javaMailSender;
  private final FeedbackMailProperties props;

  /** {@code spring.mail.username} — props.from 미설정 시 발신 주소로 사용. */
  @Value("${spring.mail.username:}")
  private String defaultFrom;

  /** 커밋 후 비동기 발송 진입점. */
  @Async
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onUserFeedbackSubmitted(UserFeedbackSubmittedEvent event) {
    send(event);
  }

  /**
   * 팀 메일 1건 발송. enabled=false 거나 수신 주소가 없으면 스킵. 발송 실패는 로깅만(재시도 없음).
   *
   * <p>{@code @TransactionalEventListener} 분리를 위해 public — 직접 호출 가능.
   */
  public void send(UserFeedbackSubmittedEvent event) {
    if (!props.isEnabled()) {
      log.info("피드백 메일 스킵(비활성): feedback_id={}", event.id());
      return;
    }
    if (props.getTo() == null || props.getTo().isBlank()) {
      log.warn("피드백 메일 스킵(수신 주소 미설정): feedback_id={}", event.id());
      return;
    }

    try {
      SimpleMailMessage message = new SimpleMailMessage();
      message.setTo(props.getTo());
      message.setFrom(resolveFrom());
      message.setSubject(buildSubject(event));
      message.setText(buildBody(event));
      javaMailSender.send(message);

      log.info("피드백 메일 전송 완료: feedback_id={}, to={}", event.id(), props.getTo());
    } catch (Exception e) {
      // DB가 원본이므로 실패해도 재시도하지 않고 로깅만.
      log.error(
          "피드백 메일 전송 실패(무시): feedback_id={}, error_class={}",
          event.id(),
          e.getClass().getSimpleName());
    }
  }

  /** {@code [DraWe-Feedback] #{id} | {yyyy-MM-dd HH:mm KST} | {본문 앞 30자}…} */
  String buildSubject(UserFeedbackSubmittedEvent event) {
    return String.format(
        "%s #%d | %s KST | %s",
        SUBJECT_PREFIX, event.id(), SUBJECT_TS.format(event.submittedAt()), snippet(event.body()));
  }

  /** 고정 키:값 구조 (파싱 가능) + 구분선 아래 본문 전체. */
  String buildBody(UserFeedbackSubmittedEvent event) {
    return "feedback_id: "
        + event.id()
        + "\nsubmitted_at: "
        + BODY_TS.format(event.submittedAt())
        + " KST"
        + "\nuser_id: "
        + orDash(event.userId())
        + "\nsession_id: "
        + orDash(event.sessionId())
        + "\nturn_count: "
        + orDash(event.turnCount())
        + "\ntrace_id: "
        + orDash(event.traceId())
        + "\n----\n"
        + event.body();
  }

  private String resolveFrom() {
    String from = props.getFrom();
    return (from != null && !from.isBlank()) ? from : defaultFrom;
  }

  /** 본문 앞 30자 요약 — 줄바꿈은 공백으로 접고, 잘리면 말줄임표(…)를 붙인다. */
  private String snippet(String body) {
    String oneLine = body.replaceAll("\\s+", " ").trim();
    if (oneLine.length() <= SNIPPET_LEN) {
      return oneLine;
    }
    return oneLine.substring(0, SNIPPET_LEN) + "…";
  }

  private String orDash(Object value) {
    return value == null ? "-" : value.toString();
  }
}
