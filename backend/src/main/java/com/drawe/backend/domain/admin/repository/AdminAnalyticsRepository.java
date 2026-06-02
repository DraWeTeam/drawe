package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.AnalyticsEvent;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 어드민 Overview 전용 집계 쿼리 (읽기 전용) — 비즈니스(사용량)만.
 *
 * <p>latency_ms·error_class 등 시스템 지표 쿼리는 observability(Tempo/Prometheus/Loki)로 분리되어 제거됨. 여기엔 활성
 * 사용자·이벤트 볼륨·이벤트 분포만 남긴다.
 *
 * <p>모든 시간 조건은 {@code created_at >= :since} (rolling window).
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

  /** window 내 event_type 분포 (전체). */
  @Query(
      value =
          "SELECT event_type AS eventType, COUNT(*) AS cnt "
              + "FROM analytics_events "
              + "WHERE created_at >= :since "
              + "GROUP BY event_type ORDER BY cnt DESC",
      nativeQuery = true)
  List<EventTypeRow> eventTypeDistribution(@Param("since") Instant since);

  interface EventTypeRow {
    String getEventType();

    long getCnt();
  }
}
