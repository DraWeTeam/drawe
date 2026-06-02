package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.AnalyticsEvent;
import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 이용 흐름 집계. (읽기 전용) 한 방 쿼리로 단계별 *세션 도달* 수를 센다. COUNT(DISTINCT CASE WHEN ...) 패턴 — 세션이 그 이벤트를 한 번이라도
 * 일으켰는지.
 */
public interface AdminFlowRepository extends JpaRepository<AnalyticsEvent, Long> {

  @Query(
      value =
          "SELECT "
              + " COUNT(DISTINCT session_id) AS sessions, "
              + " COUNT(DISTINCT CASE WHEN event_type='chat_start'"
              + "        THEN session_id END) AS started, "
              + " COUNT(DISTINCT CASE WHEN event_type='search_executed'"
              + "        THEN session_id END) AS searched, "
              + " COUNT(DISTINCT CASE WHEN event_type='search_blocked'"
              + "        THEN session_id END) AS blocked, "
              + " COUNT(DISTINCT CASE WHEN event_type='chat_success'"
              + "        THEN session_id END) AS succeeded, "
              + " COUNT(DISTINCT CASE WHEN event_type='chat_error'"
              + "        THEN session_id END) AS errored, "
              + " COUNT(DISTINCT CASE WHEN event_type='onboarding_completed'"
              + "        THEN session_id END) AS onboarded "
              + "FROM analytics_events "
              + "WHERE created_at >= :since AND session_id IS NOT NULL",
      nativeQuery = true)
  FlowRow flow(@Param("since") Instant since);

  interface FlowRow {
    Number getSessions();

    Number getStarted();

    Number getSearched();

    Number getBlocked();

    Number getSucceeded();

    Number getErrored();

    Number getOnboarded();
  }
}
