package com.drawe.backend.domain.admin.repository;

import com.drawe.backend.domain.AnalyticsEvent;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 비용·사용량 집계. (읽기 전용)
 *
 * <p>토큰은 {@code chat_success} payload의 {@code prompt_tokens}/{@code completion_tokens}를 JSON에서 뽑아
 * 합산한다(토큰 로깅 배포 후 발생분만 존재). AI 이미지 생성 수는 {@code image_generated} 이벤트로 윈도우 집계하고,
 * 누적 보강용으로 {@code images.source='AI'}도 본다. 네이티브 쿼리라 한 리포지토리에서 여러 테이블을 조회해도 무방.
 *
 * <p>일자 그룹핑은 KST 기준 — created_at(UTC)에 {@code +09:00} offset을 적용한다(tz 테이블 불필요).
 */
public interface AdminCostRepository extends JpaRepository<AnalyticsEvent, Long> {

  /** chat_success 호출 수 + 토큰 기록 수 + 토큰 합계 (윈도우). */
  @Query(
      value =
          "SELECT COUNT(*) AS chatCalls, "
              + "  SUM(CASE WHEN JSON_EXTRACT(payload,'$.prompt_tokens') IS NOT NULL "
              + "      THEN 1 ELSE 0 END) AS callsWithTokens, "
              + "  COALESCE(SUM(CAST(JSON_EXTRACT(payload,'$.prompt_tokens') AS SIGNED)),0) "
              + "      AS promptTokens, "
              + "  COALESCE(SUM(CAST(JSON_EXTRACT(payload,'$.completion_tokens') AS SIGNED)),0) "
              + "      AS completionTokens "
              + "FROM analytics_events "
              + "WHERE event_type='chat_success' AND created_at >= :since",
      nativeQuery = true)
  TokenKpiRow tokenKpi(@Param("since") Instant since);

  /** provider+model별 호출/토큰 (윈도우). 비용은 서비스에서 단가 적용. */
  @Query(
      value =
          "SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.provider')),'(unknown)') "
              + "      AS provider, "
              + "  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.model')),'(unknown)') AS model, "
              + "  COUNT(*) AS calls, "
              + "  COALESCE(SUM(CAST(JSON_EXTRACT(payload,'$.prompt_tokens') AS SIGNED)),0) "
              + "      AS promptTokens, "
              + "  COALESCE(SUM(CAST(JSON_EXTRACT(payload,'$.completion_tokens') AS SIGNED)),0) "
              + "      AS completionTokens "
              + "FROM analytics_events "
              + "WHERE event_type='chat_success' AND created_at >= :since "
              + "GROUP BY provider, model "
              + "ORDER BY calls DESC",
      nativeQuery = true)
  List<ProviderProj> providerBreakdown(@Param("since") Instant since);

  /** image_generated 이벤트 수 (윈도우 = Bria 호출 수). */
  @Query(
      value =
          "SELECT COUNT(*) FROM analytics_events "
              + "WHERE event_type='image_generated' AND created_at >= :since",
      nativeQuery = true)
  long imageGenCount(@Param("since") Instant since);

  /** 일별 AI 이미지 생성 수. (created_at 표기는 기존 repo와 동일하게 저장값 그대로) */
  @Query(
      value =
          "SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS day, COUNT(*) AS cnt "
              + "FROM analytics_events "
              + "WHERE event_type='image_generated' AND created_at >= :since "
              + "GROUP BY day ORDER BY day",
      nativeQuery = true)
  List<DailyProj> dailyImageGen(@Param("since") Instant since);

  /** images.source='AI' 누적(전체 기간) + 그중 Pinecone 적재 완료 수. (image_generated 도입 전 과거치 보강용) */
  @Query(
      value =
          "SELECT COUNT(*) AS total, "
              + "  SUM(CASE WHEN indexed_at IS NOT NULL THEN 1 ELSE 0 END) AS indexed "
              + "FROM images WHERE source='AI'",
      nativeQuery = true)
  AiImageRow aiImageTotals();

  interface TokenKpiRow {
    Number getChatCalls();

    Number getCallsWithTokens();

    Number getPromptTokens();

    Number getCompletionTokens();
  }

  interface ProviderProj {
    String getProvider();

    String getModel();

    Number getCalls();

    Number getPromptTokens();

    Number getCompletionTokens();
  }

  interface DailyProj {
    String getDay();

    Number getCnt();
  }

  interface AiImageRow {
    Number getTotal();

    Number getIndexed();
  }
}
