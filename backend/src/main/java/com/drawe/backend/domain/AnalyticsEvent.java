package com.drawe.backend.domain;

import jakarta.persistence.*;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 사용자 행동 funnel 분석용 이벤트 저장.
 *
 * <p>SearchLog와는 역할 분리:
 *
 * <ul>
 *   <li>SearchLog — 검색 detail (어떤 키워드로 어떤 ref 나왔는지 raw 데이터, 검색 품질 개선용)
 *   <li>AnalyticsEvent — 행동 funnel (사용자가 무슨 액션을 어떤 순서로 했는지 요약, 분석/통계용)
 * </ul>
 *
 * <p>payload는 JSON 문자열로 저장. event_type별로 다른 구조 가능 (유연성 우선).
 *
 * <p>예시 payload:
 *
 * <ul>
 *   <li>search_executed: {"keyword":"...", "result_count":6, "avg_score":0.78, "max_score":0.87}
 *   <li>chat_success: {"latency_ms":2300, "response_length":450, "provider":"GROK"}
 *   <li>chat_error: {"error_class":"AIServiceException", "error_msg":"..."}
 * </ul>
 */
@Getter
@Setter
@Entity
@Table(
    name = "analytics_events",
    indexes = {
      @Index(name = "idx_event_user_time", columnList = "user_id, created_at"),
      @Index(name = "idx_event_session", columnList = "session_id"),
      @Index(name = "idx_event_type_time", columnList = "event_type, created_at")
    })
public class AnalyticsEvent {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "id", nullable = false)
  private Long id;

  /** 사용자 ID. 인증 안 된 액션이면 null 가능. */
  @Column(name = "user_id")
  private Long userId;

  /** 채팅 세션 ID (UUID 문자열). 세션 없는 액션이면 null. */
  @Column(name = "session_id", length = 64)
  private String sessionId;

  /**
   * 분산 추적 ID (W3C trace context, 32 hex). OTel Agent가 요청 경계에서 MDC에 주입한 값을 적재 시 함께 저장한다 —
   * admin(analytics) ↔ Tempo/Loki 조인 키. 요청 컨텍스트 밖(스케줄러 · {@code @Async} AFTER_COMMIT)이나 Agent 미적용
   * 구간에서는 null.
   */
  @Column(name = "trace_id", length = 32)
  private String traceId;

  /** 이벤트 타입. 예: chat_start, search_executed, guide_completed. */
  @Column(name = "event_type", nullable = false, length = 50)
  private String eventType;

  /** 이벤트 상세 데이터. JSON 문자열로 저장 (유연한 스키마). */
  @Column(name = "payload", columnDefinition = "json")
  private String payloadJson;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;
}
