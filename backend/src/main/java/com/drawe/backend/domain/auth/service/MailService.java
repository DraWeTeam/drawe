package com.drawe.backend.domain.auth.service;

import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

@Service
@Slf4j
@RequiredArgsConstructor
public class MailService {

  private final JavaMailSender javaMailSender;

  @Value("${spring.mail.username}")
  private String from;

  public void send(String subject, String body, String to) {
    SimpleMailMessage message = new SimpleMailMessage();
    message.setTo(to);
    message.setFrom(from);
    message.setSubject(subject);
    message.setText(body);
    javaMailSender.send(message);

    log.info("메일 전송 완료: 제목={}, 수신자={}", subject, to);
  }

  /**
   * HTML 본문 메일 발송 (Thymeleaf 등으로 렌더한 htmlBody 전달). 브랜드 로고를 CID("logo")로 인라인 첨부 — 템플릿에서 &lt;img
   * src="cid:logo"&gt; 로 참조. (SVG는 메일 클라이언트가 차단하므로 PNG 사용)
   */
  public void sendHtml(String subject, String htmlBody, String to) {
    try {
      MimeMessage message = javaMailSender.createMimeMessage();
      // multipart=true: 인라인 이미지 첨부를 위해 멀티파트 모드
      MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
      helper.setTo(to);
      helper.setFrom(from);
      helper.setSubject(subject);
      helper.setText(htmlBody, true); // true = HTML 모드
      helper.addInline("logo", new ClassPathResource("templates/drawe_logo.png"));
      javaMailSender.send(message);

      log.info("HTML 메일 전송 완료: 제목={}, 수신자={}", subject, to);
    } catch (MessagingException e) {
      log.error("HTML 메일 전송 실패: 수신자={}", to, e);
      throw new CustomException(ErrorCode.INTERNAL_SERVER_ERROR);
    }
  }
}
