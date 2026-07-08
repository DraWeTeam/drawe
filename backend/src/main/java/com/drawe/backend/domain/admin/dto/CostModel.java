package com.drawe.backend.domain.admin.dto;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Locale;

/**
 * 어드민 Cost(비용·사용량) 탭 뷰모델.
 *
 * <p>토큰·비용은 {@code chat_success} payload의 {@code prompt_tokens}/{@code completion_tokens}에서 나온다 — 이
 * 필드는 <b>토큰 로깅 배포 이후</b> 발생한 호출에만 있으므로, 배포 직후 윈도우에서는 토큰·비용이 0/부분일 수 있다(화면에 안내). 과거 구간은 별도 사후 추정
 * 스크립트(scripts/token_estimate.py)로 메운다.
 *
 * <p>AI 이미지 생성 수는 {@code image_generated} 이벤트(윈도우 집계)와, 과거치 보강용 {@code images.source='AI'} 누적 카운트를
 * 같이 보여준다.
 */
public record CostModel() {

  public record View(
      int windowHours,
      String generatedAtText,
      Kpi kpi,
      List<ProviderRow> providers,
      List<DailyGen> dailyImageGen,
      boolean pricingConfigured,
      AwsCost aws) {}

  /** USD 표기 — null 이면 "—". */
  private static String usd(BigDecimal v) {
    return v == null ? "—" : "$" + v.setScale(2, RoundingMode.HALF_UP).toPlainString();
  }

  /** AWS 서비스별 비용 한 줄(Cost Explorer SERVICE 디멘션). */
  public record ServiceCost(String service, BigDecimal amountUsd) {
    public String amountText() {
      return usd(amountUsd);
    }
  }

  /**
   * Cost Explorer 조회 원시 스냅샷(AwsCostService 산출). per-user 는 여기서 계산하지 않는다(활성 사용자는 analytics 소관).
   *
   * @param available CE 조회 성공 여부(false 면 화면에 statusText 안내)
   * @param aiSubtotalUsd 서비스명이 "(Amazon Bedrock Edition)" 포함하는 것들 합계(LLM·이미지)
   */
  public record AwsCostSnapshot(
      boolean available,
      String statusText,
      String monthLabel,
      BigDecimal totalUsd,
      List<ServiceCost> services,
      BigDecimal aiSubtotalUsd) {}

  /** 화면용 AWS 비용 뷰(스냅샷 + 사용자당). */
  public record AwsCost(
      boolean available,
      String statusText,
      String monthLabel,
      BigDecimal totalUsd,
      BigDecimal perUserUsd,
      long activeUsers,
      List<ServiceCost> services,
      BigDecimal aiSubtotalUsd) {

    public String totalText() {
      return usd(totalUsd);
    }

    public String perUserText() {
      return usd(perUserUsd);
    }

    public String aiSubtotalText() {
      return usd(aiSubtotalUsd);
    }
  }

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
