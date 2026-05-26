package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.log.SearchLog;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 검색 품질 집계. (읽기 전용)
 *
 * <p>"차단/저품질"의 정의는 {@code result_count = 0 OR avg_score < 0.2}. {@code original_message}(PII)는 어떤
 * 쿼리에서도 select 하지 않는다 — 키워드 집계만. {@code extracted_keywords}는 VARCHAR라 그대로 GROUP BY.
 *
 * <p>마찰(friction) 쿼리는 {@code search_logs}가 아니라 <b>{@code analytics_events}</b>를 본다 — 세션 시퀀스가 필요하기
 * 때문(search_logs엔 session_id가 없음). 네이티브 쿼리는 엔티티 테이블에 묶이지 않으므로 같은 리포지토리에서 다른 테이블을 조회해도 된다.
 */
public interface AdminSearchRepository extends JpaRepository<SearchLog, Long> {

  /** 상단 KPI 한 행. */
  @Query(
      value =
          "SELECT COUNT(*) AS total, "
              + "       SUM(CASE WHEN result_count = 0 OR avg_score < 0.2 THEN 1 ELSE 0 END)"
              + "           AS blocked, "
              + "       AVG(result_count) AS avgResults, "
              + "       AVG(avg_score) AS avgScore "
              + "FROM search_logs "
              + "WHERE created_at >= :since",
      nativeQuery = true)
  KpiRow kpi(@Param("since") Instant since);

  /**
   * 검색 마찰 코어 — 세션별 검색 횟수/성공 횟수를 한 번 집계한 뒤, 검색세션·재검색세션·루프세션을 센다.
   *
   * <ul>
   *   <li>검색 = {@code search_executed} 또는 {@code search_blocked}
   *   <li>재검색 세션 = 검색 2회 이상
   *   <li>루프 세션 = 검색 3회 이상 그리고 성공 0
   * </ul>
   */
  @Query(
      value =
          "SELECT "
              + "  SUM(CASE WHEN searches >= 1 THEN 1 ELSE 0 END) AS searchSessions, "
              + "  SUM(CASE WHEN searches >= 2 THEN 1 ELSE 0 END) AS researchSessions, "
              + "  SUM(CASE WHEN searches >= 3 AND successes = 0 THEN 1 ELSE 0 END)"
              + "    AS loopSessions "
              + "FROM ( "
              + "  SELECT session_id, "
              + "    SUM(CASE WHEN event_type IN ('search_executed','search_blocked')"
              + "        THEN 1 ELSE 0 END) AS searches, "
              + "    SUM(CASE WHEN event_type = 'chat_success' THEN 1 ELSE 0 END) AS successes "
              + "  FROM analytics_events "
              + "  WHERE created_at >= :since AND session_id IS NOT NULL "
              + "  GROUP BY session_id "
              + ") t",
      nativeQuery = true)
  FrictionCoreRow frictionCore(@Param("since") Instant since);

  /**
   * 차단 세션 + 차단 후 멈춤(근사 이탈) — 세션별로 (차단을 겪었나) + (마지막 이벤트가 무엇인가)를 구한 뒤 집계.
   *
   * <p>마지막 이벤트는 {@code GROUP_CONCAT(... ORDER BY created_at DESC)}의 첫 토큰으로 구한다(윈도우 함수 없이). 한 세션 이벤트
   * 수는 적어 {@code group_concat_max_len} 한도에 닿지 않는다.
   */
  @Query(
      value =
          "SELECT "
              + "  SUM(hadBlock) AS blockedSessions, "
              + "  SUM(CASE WHEN lastType = 'search_blocked' THEN 1 ELSE 0 END)"
              + "    AS abandonAfterBlock "
              + "FROM ( "
              + "  SELECT session_id, "
              + "    MAX(CASE WHEN event_type = 'search_blocked' THEN 1 ELSE 0 END) AS hadBlock, "
              + "    SUBSTRING_INDEX(GROUP_CONCAT(event_type ORDER BY"
              + "      created_at DESC, id DESC SEPARATOR '|'), '|', 1) AS lastType "
              + "  FROM analytics_events "
              + "  WHERE created_at >= :since AND session_id IS NOT NULL "
              + "  GROUP BY session_id "
              + ") t",
      nativeQuery = true)
  BlockAbandonRow blockAbandon(@Param("since") Instant since);

  /** 시드 보강 백로그 — 차단/저품질 검색을 키워드별 빈도순. */
  @Query(
      value =
          "SELECT COALESCE(extracted_keywords, '(없음)') AS keyword, "
              + "       COUNT(*) AS cnt, "
              + "       AVG(avg_score) AS avgScore, "
              + "       DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i') AS lastAt "
              + "FROM search_logs "
              + "WHERE created_at >= :since AND (result_count = 0 OR avg_score < 0.2) "
              + "GROUP BY extracted_keywords "
              + "ORDER BY cnt DESC LIMIT 30",
      nativeQuery = true)
  List<BacklogProj> backlog(@Param("since") Instant since);

  /** 검색 수요 TOP — 전체 키워드 빈도 + 품질. */
  @Query(
      value =
          "SELECT COALESCE(extracted_keywords, '(없음)') AS keyword, "
              + "       COUNT(*) AS cnt, "
              + "       AVG(result_count) AS avgResults, "
              + "       AVG(avg_score) AS avgScore, "
              + "       SUM(CASE WHEN result_count = 0 OR avg_score < 0.2 THEN 1 ELSE 0 END)"
              + "           AS blockedCnt "
              + "FROM search_logs "
              + "WHERE created_at >= :since "
              + "GROUP BY extracted_keywords "
              + "ORDER BY cnt DESC LIMIT 30",
      nativeQuery = true)
  List<DemandProj> demand(@Param("since") Instant since);

  /** SUM/COUNT은 드라이버가 BigDecimal/Long 등으로 줄 수 있어 Number로 받는다. */
  interface KpiRow {
    Number getTotal();

    Number getBlocked();

    Double getAvgResults();

    Double getAvgScore();
  }

  interface FrictionCoreRow {
    Number getSearchSessions();

    Number getResearchSessions();

    Number getLoopSessions();
  }

  interface BlockAbandonRow {
    Number getBlockedSessions();

    Number getAbandonAfterBlock();
  }

  interface BacklogProj {
    String getKeyword();

    Number getCnt();

    Double getAvgScore();

    String getLastAt();
  }

  interface DemandProj {
    String getKeyword();

    Number getCnt();

    Double getAvgResults();

    Double getAvgScore();

    Number getBlockedCnt();
  }
}
