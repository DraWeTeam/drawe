package com.drawe.backend.domain;

import com.drawe.backend.domain.enums.FeedbackType;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 가이드 전체 피드백(👍/👎). adoption_log(레퍼런스 단위 소비 기록)와 분리된 "가이드가 유용했는가" 수집용.
 *
 * <p>ImageFeedback 와 동일 패턴(공용 {@link FeedbackType} + @Enumerated STRING + (user,guide) UNIQUE).
 * user 는 nullable — 현재 엔드포인트는 인증 필수라 항상 채워지지만, 추후 익명(session_id) 피드백 여지를 둔다.
 */
@Getter
@Setter
@Entity
@Table(
    name = "guide_feedback",
    uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "guide_id"}))
public class GuideFeedback {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "id", nullable = false)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "user_id")
  private User user;

  @NotNull
  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "guide_id", nullable = false)
  private Guide guide;

  @Column(name = "session_id", length = 64)
  private String sessionId;

  @NotNull
  @Enumerated(EnumType.STRING)
  @Column(name = "feedback", nullable = false)
  private FeedbackType feedback;

  @CreationTimestamp
  @Column(name = "created_at", updatable = false)
  private Instant createdAt;
}
