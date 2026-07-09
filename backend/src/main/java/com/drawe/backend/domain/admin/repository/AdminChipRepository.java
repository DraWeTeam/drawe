package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.AnalyticsEvent;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 칩 분석 집계 (읽기 전용, 네이티브).
 *
 * <p>노출 = {@code analytics_events} 의 {@code chip_shown} payload.chips 를 JSON_TABLE 로 unnest. 반영 = {@code
 * projects.keywords}(JSON 배열)를 JSON_TABLE 로 unnest. 라벨 정규화·조인·전환율은 서비스(순수 함수)에서 한다.
 *
 * <p>네이티브 쿼리는 엔티티 테이블에 묶이지 않으므로 같은 리포지토리에서 analytics_events / projects 를 각각 조회해도 된다.
 */
public interface AdminChipRepository extends JpaRepository<AnalyticsEvent, Long> {

  /** 라벨별 노출수 + 평균 position (chip_shown, 윈도우). */
  @Query(
      value =
          "SELECT jt.label AS label, COUNT(*) AS cnt, AVG(jt.pos) AS avgPosition "
              + "FROM analytics_events a "
              + "JOIN JSON_TABLE(a.payload, '$.chips[*]' COLUMNS ("
              + "  label VARCHAR(100) PATH '$.label', pos INT PATH '$.position')) jt "
              + "WHERE a.event_type = 'chip_shown' AND a.created_at >= :since "
              + "GROUP BY jt.label",
      nativeQuery = true)
  List<ShownProj> shownByLabel(@Param("since") Instant since);

  /** 라벨별 반영수 (projects.keywords unnest, 윈도우=created_at). */
  @Query(
      value =
          "SELECT jt.label AS label, COUNT(*) AS cnt "
              + "FROM projects p "
              + "JOIN JSON_TABLE(p.keywords, '$[*]' COLUMNS (label VARCHAR(100) PATH '$')) jt "
              + "WHERE p.created_at >= :since "
              + "GROUP BY jt.label",
      nativeQuery = true)
  List<ReflectProj> reflectByLabel(@Param("since") Instant since);

  interface ShownProj {
    String getLabel();

    Number getCnt();

    Double getAvgPosition();
  }

  interface ReflectProj {
    String getLabel();

    Number getCnt();
  }
}
