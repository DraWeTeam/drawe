package com.drawe.backend.domain.auth.service;

import com.drawe.backend.domain.User;
import com.drawe.backend.domain.auth.dto.FeedbackRequest;
import com.drawe.backend.domain.auth.repository.UserRepository;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** 사용자 피드백을 운영 이메일로 전달한다 (DB 저장 없이 메일만). */
@Service
@RequiredArgsConstructor
public class FeedbackService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter SENT_AT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

  private final UserRepository userRepository;
  private final MailService mailService;

  // 피드백 수신함. 미설정 시 SMTP 발신 계정(자기 자신)으로 받는다.
  @Value("${app.feedback.inbox:${spring.mail.username}}")
  private String inbox;

  public void sendFeedback(Long userId, FeedbackRequest request) {
    // 로그인 사용자라도 식별은 참고용 — 없으면 익명으로 처리한다.
    User user = userRepository.findById(userId).orElse(null);
    String who = user != null ? user.getNickname() : "익명";
    String email = user != null ? user.getEmail() : "(알 수 없음)";

    String subject = "[DraWe 피드백] " + who;
    String body =
        "보낸 사람: " + who + " <" + email + ">\n"
            + "유저 ID: " + (user != null ? user.getId() : "(알 수 없음)") + "\n"
            + "전송 시각: " + ZonedDateTime.now(KST).format(SENT_AT) + " (KST)\n"
            + "------------------------------------------------------------\n"
            + request.getMessage();

    mailService.send(subject, body, inbox);
  }
}
