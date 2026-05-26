package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.AnalyticsEvent;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 어드민 대시보드 전용 집계 쿼리. (읽기 전용)
 *
 * <p>{@link com.drawe.backend.domain.analytics.repository.AnalyticsEventRepository} 와 같은 엔티티를 쓰지만,
 * 어드민 관심사(집계/통계)를 운영 코드와 섞지 않으려고 모듈을 분리한다. 전부 native query — payload(JSON)에서 값을 뽑아야 하고, 어드민은 엔티티
 * 그래프가 아니라 숫자만 필요하기 때문.
 *
 * <p>모든 시간 조건은 {@code created_at >= :since} (rolling window). 호출 측에서 {@code now - hours} 를 넘긴다.
 */
public interface AdminAnalyticsRepository extends JpaRepository<AnalyticsEvent, Long> {

  /** window 내 고유 사용자 수 (user_id null 인 비로그인 액션 제외). */
  @Query(
      value =
          "SELECT COUNT(DISTINCT user_id) FROM analytics_events "
              + "WHERE created_at >= :since AND user_id IS NOT NULL",
      nativeQuery = true)
  long countActiveUsers(@Param("since") Instant since);

  /** 특정 event_type 의 window 내 발생 수. */
  @Query(
      value =
          "SELECT COUNT(*) FROM analytics_events "
              + "WHERE event_type = :type AND created_at >= :since",
      nativeQuery = true)
  long countByType(@Param("type") String type, @Param("since") Instant since);

  /**
   * window 내 chat_success 의 latency_ms 값 목록.
   *
   * <p>P50/P95 는 MySQL 집계로 깔끔히 안 나와서(=PERCENTILE_CONT 미지원), 값만 뽑아 Java에서 계산한다. 베타 표본이 작아 비용 무시 가능.
   * 트래픽 커지면 Phase 후순위로 사전 집계 테이블/CloudWatch 로 이관.
   */
  @Query(
      value =
          "SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.latency_ms')) AS SIGNED) "
              + "FROM analytics_events "
              + "WHERE event_type = 'chat_success' AND created_at >= :since "
              + "AND JSON_EXTRACT(payload, '$.latency_ms') IS NOT NULL",
      nativeQuery = true)
  List<Number> findChatLatencies(@Param("since") Instant since);

  /** window 내 chat_error 의 error_class 별 빈도 Top N. */
  @Query(
      value =
          "SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.error_class')) AS errorClass, "
              + "COUNT(*) AS cnt "
              + "FROM analytics_events "
              + "WHERE event_type = 'chat_error' AND created_at >= :since "
              + "GROUP BY errorClass ORDER BY cnt DESC LIMIT 8",
      nativeQuery = true)
  List<ErrorClassRow> topErrorClasses(@Param("since") Instant since);

  /** window 내 event_type 분포 (전체). */
  @Query(
      value =
          "SELECT event_type AS eventType, COUNT(*) AS cnt "
              + "FROM analytics_events "
              + "WHERE created_at >= :since "
              + "GROUP BY event_type ORDER BY cnt DESC",
      nativeQuery = true)
  List<EventTypeRow> eventTypeDistribution(@Param("since") Instant since);

  /** native projection — 컬럼 alias(errorClass, cnt)와 getter 이름이 매칭됨. */
  interface ErrorClassRow {
    String getErrorClass();

    long getCnt();
  }

  interface EventTypeRow {
    String getEventType();

    long getCnt();
  }
}
