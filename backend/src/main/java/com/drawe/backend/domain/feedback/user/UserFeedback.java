package com.drawe.backend.domain.feedback.user;

import jakarta.persistence.*;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 사용자 자유서술 피드백 — 채팅 N턴 후 모달로 제출된 원문.
 *
 * <p>기존 {@link com.drawe.backend.domain.ImageFeedback}(이미지 좋아요/싫어요 enum)와는 성격이 완전히 다른, 자유 텍스트 피드백이라
 * 이름을 {@code UserFeedback} 으로 분리한다.
 *
 * <p><b>SoT</b>: 이 테이블이 피드백 원본. 팀 공용 메일은 알림 채널일 뿐이며, 발송 실패해도 원본은 여기 남는다.
 *
 * <p>{@code sentiment / category / category2 / classifiedBy / classifiedAt} 는 향후 어드민 분류용 컬럼으로, 지금은
 * 항상 {@code null} 로 적재된다 (자동 감정 분류 없음). V21 마이그레이션의 {@code idx_feedback_unclassified} (sentiment,
 * created_at) 가 미분류 큐 조회를 위한 선반영 인덱스.
 */
@Getter
@Setter
@Entity
@Table(
    name = "user_feedback",
    indexes = {
      @Index(name = "idx_feedback_created", columnList = "created_at"),
      @Index(name = "idx_feedback_unclassified", columnList = "sentiment, created_at")
    })
public class UserFeedback {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "id", nullable = false)
  private Long id;

  /** 제출한 사용자 ID. 인증 컨텍스트에서 채운다 (익명 제출 대비 nullable). */
  @Column(name = "user_id")
  private Long userId;

  /** 채팅 세션 ID (UUID 문자열). 피드백을 유발한 대화 세션. 없으면 null. */
  @Column(name = "session_id", length = 64)
  private String sessionId;

  /**
   * 분산 추적 ID (W3C trace context, 32 hex). AnalyticsEvent 와 동일하게 요청 경계에서 OTel Agent 가 MDC 에 주입한 값을
   * 적재 시 함께 저장 — Tempo/Loki 조인 키. 요청 밖이거나 Agent 미적용 구간에서는 null.
   */
  @Column(name = "trace_id", length = 32)
  private String traceId;

  /** 피드백 본문 (자유서술 원문). PII 라 로그·analytics payload 엔 길이만 남긴다. */
  @Column(name = "body", nullable = false, columnDefinition = "TEXT")
  private String body;

  /** 제출 시점의 채팅 누적 턴 수. 없으면 null. */
  @Column(name = "turn_count")
  private Integer turnCount;

  /** 향후 어드민 감정 분류 결과 (positive/negative/...). 지금은 항상 null. */
  @Column(name = "sentiment", length = 16)
  private String sentiment;

  /** 향후 어드민 카테고리 분류. 지금은 항상 null. */
  @Column(name = "category", length = 32)
  private String category;

  /** 향후 어드민 보조 카테고리 분류. 지금은 항상 null. */
  @Column(name = "category2", length = 32)
  private String category2;

  /** 향후 분류 주체 (사람 계정 또는 배치 이름). 지금은 항상 null. */
  @Column(name = "classified_by", length = 64)
  private String classifiedBy;

  /** 향후 분류 시각. 지금은 항상 null. */
  @Column(name = "classified_at")
  private Instant classifiedAt;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;
}
