package com.drawe.backend.domain.admin.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * 어드민 Cost(비용·사용량) 탭 뷰모델.
 *
 * <p>토큰·비용은 {@code chat_success} payload의 {@code prompt_tokens}/{@code completion_tokens}에서 나온다 — 이
 * 필드는 <b>토큰 로깅 배포 이후</b> 발생한 호출에만 있으므로, 배포 직후 윈도우에서는 토큰·비용이 0/부분일 수 있다(화면에 안내). 과거 구간은 별도 사후 추정
 * 스크립트(scripts/token_estimate.py)로 메운다.
 *
 * <p>AI 이미지 생성 수는 {@code image_generated} 이벤트(윈도우 집계)와, 과거치 보강용 {@code images.source='AI'} 누적
 * 카운트를 같이 보여준다.
 */
public record CostModel() {

  public record View(
      int windowHours,
      String generatedAtText,
      Kpi kpi,
      List<ProviderRow> providers,
      List<DailyGen> dailyImageGen,
      boolean pricingConfigured) {}

  public record Kpi(
      long chatCalls, // chat_success 수 (윈도우)
      long callsWithTokens, // 그중 토큰이 기록된 수 (= 토큰 로깅 적용 후)
      long promptTokens,
      long completionTokens,
      BigDecimal estCostUsd, // null = 단가 미설정
      long imageGenWindow, // image_generated 이벤트 수 (윈도우)
      long imageAiTotal, // images.source='AI' 누적 (전체 기간)
      long imageAiIndexed) {} // 그중 Pinecone 적재 완료 (indexed_at IS NOT NULL)

  /** provider+model별 호출/토큰/추정비용. */
  public record ProviderRow(
      String provider,
      String model,
      long calls,
      long promptTokens,
      long completionTokens,
      BigDecimal estCostUsd) {} // null = 해당 provider 단가 미설정

  /** 일별 AI 이미지 생성 수 (KST 기준). */
  public record DailyGen(String day, long count) {}
}
