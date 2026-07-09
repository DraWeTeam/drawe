package com.drawe.backend.domain.feedback.user.mail;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 팀 공용 피드백 메일 설정 (prefix {@code drawe.feedback.mail}).
 *
 * <p>SMTP 접속 정보(host/port/계정)는 표준 {@code spring.mail.*} 를 그대로 쓰고, 여기선 "피드백 알림" 도메인 설정만 둔다.
 *
 * <p>{@code enabled} 기본값 false — 로컬/테스트에서 실수로 메일이 나가지 않게 한다. 켜려면 to(수신) 를 반드시 채울 것.
 */
@Getter
@Setter
@Configuration
@ConfigurationProperties(prefix = "drawe.feedback.mail")
public class FeedbackMailProperties {

  /** 발송 on/off. false(기본)면 발송을 건너뛰고 info 로그만 남긴다. */
  private boolean enabled = false;

  /** 수신 주소 — 팀 공용 메일함. enabled=true 인데 비어 있으면 발송 스킵(경고 로그). */
  private String to;

  /** 발신 주소. 비우면 {@code spring.mail.username} 을 쓴다 (FeedbackMailService 에서 대체). */
  private String from;
}
