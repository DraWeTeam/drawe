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
 *
 * <p>{@code backlog}/{@code demand}는 페이지네이션 + 검색({@code q}) 지원 — {@code extracted_keywords} 부분일치.
 * 빈 q는 모두 통과({@code :q = ''} 분기).
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

  // ── 시드 보강 백로그 ──

  /** 차단/저품질 검색을 키워드별 빈도순 + 검색(q) + 페이지네이션. */
  @Query(
      value =
          "SELECT COALESCE(extracted_keywords, '(없음)') AS keyword, "
              + "       COUNT(*) AS cnt, "
              + "       AVG(avg_score) AS avgScore, "
              + "       DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i') AS lastAt "
              + "FROM search_logs "
              + "WHERE created_at >= :since AND (result_count = 0 OR avg_score < 0.2) "
              + "  AND (:q = '' OR extracted_keywords LIKE CONCAT('%', :q, '%')) "
              + "GROUP BY extracted_keywords "
              + "ORDER BY cnt DESC "
              + "LIMIT :size OFFSET :offset",
      nativeQuery = true)
  List<BacklogProj> backlog(
      @Param("since") Instant since,
      @Param("q") String q,
      @Param("size") int size,
      @Param("offset") int offset);

  /** 백로그 총 키워드 수(필터 적용 후) — 페이지네이션용. */
  @Query(
      value =
          "SELECT COUNT(*) FROM ( "
              + "  SELECT extracted_keywords "
              + "  FROM search_logs "
              + "  WHERE created_at >= :since AND (result_count = 0 OR avg_score < 0.2) "
              + "    AND (:q = '' OR extracted_keywords LIKE CONCAT('%', :q, '%')) "
              + "  GROUP BY extracted_keywords "
              + ") c",
      nativeQuery = true)
  long backlogCount(@Param("since") Instant since, @Param("q") String q);

  // ── 검색 수요 TOP ──

  /** 전체 키워드 빈도 + 품질 + 검색(q) + 페이지네이션. */
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
              + "  AND (:q = '' OR extracted_keywords LIKE CONCAT('%', :q, '%')) "
              + "GROUP BY extracted_keywords "
              + "ORDER BY cnt DESC "
              + "LIMIT :size OFFSET :offset",
      nativeQuery = true)
  List<DemandProj> demand(
      @Param("since") Instant since,
      @Param("q") String q,
      @Param("size") int size,
      @Param("offset") int offset);

  /** 수요 총 키워드 수(필터 적용 후). */
  @Query(
      value =
          "SELECT COUNT(*) FROM ( "
              + "  SELECT extracted_keywords "
              + "  FROM search_logs "
              + "  WHERE created_at >= :since "
              + "    AND (:q = '' OR extracted_keywords LIKE CONCAT('%', :q, '%')) "
              + "  GROUP BY extracted_keywords "
              + ") c",
      nativeQuery = true)
  long demandCount(@Param("since") Instant since, @Param("q") String q);

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
