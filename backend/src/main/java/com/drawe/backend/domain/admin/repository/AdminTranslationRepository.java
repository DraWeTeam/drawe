package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.log.PromptTranslationLog;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 번역 로그 집계. (읽기 전용)
 *
 * <p>{@code ko_prompt}/{@code en_prompt}(PII)는 select 하지 않는다. 상태 카운트와 실패 사유(error_message) 집계만.
 */
public interface AdminTranslationRepository extends JpaRepository<PromptTranslationLog, Long> {

  /** 상태 분포 한 행. */
  @Query(
      value =
          "SELECT COUNT(*) AS total, "
              + "       SUM(status = 'SUCCESS') AS success, "
              + "       SUM(status = 'FALLBACK_RAW') AS fallback, "
              + "       SUM(status = 'FAILED') AS failed "
              + "FROM prompt_translation_logs "
              + "WHERE created_at >= :since",
      nativeQuery = true)
  KpiRow kpi(@Param("since") Instant since);

  /** 실패/폴백을 사유·상태별로 빈도순. (SUCCESS 제외) */
  @Query(
      value =
          "SELECT COALESCE(NULLIF(error_message, ''), '(사유 없음)') AS reason, "
              + "       status AS status, "
              + "       COUNT(*) AS cnt, "
              + "       DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i') AS lastAt "
              + "FROM prompt_translation_logs "
              + "WHERE created_at >= :since AND status <> 'SUCCESS' "
              + "GROUP BY error_message, status "
              + "ORDER BY cnt DESC LIMIT 30",
      nativeQuery = true)
  List<FailureProj> failures(@Param("since") Instant since);

  interface KpiRow {
    Number getTotal();

    Number getSuccess();

    Number getFallback();

    Number getFailed();
  }

  interface FailureProj {
    String getReason();

    String getStatus();

    Number getCnt();

    String getLastAt();
  }
}
