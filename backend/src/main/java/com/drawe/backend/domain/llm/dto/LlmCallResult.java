package com.drawe.backend.domain.llm.dto;

/**
 * LLM 호출 1건의 결과.
 *
 * <p>{@code promptTokens}/{@code completionTokens}는 provider 응답의 usage에서 뽑은 <b>실제 청구 토큰</b>이다.
 * provider가 usage를 안 주거나 파싱 실패 시 {@code null} — 호출 자체는 절대 실패시키지 않는다(부가 정보). 비용/사용량 분석(어드민 Cost 탭)에서
 * 소비하며, 없으면 "—"로 표기된다.
 */
public record LlmCallResult(
    String content, String model, int latencyMs, Integer promptTokens, Integer completionTokens) {

  /** usage 없이(또는 추출 실패) 만들 때. */
  public static LlmCallResult of(String content, String model, int latencyMs) {
    return new LlmCallResult(content, model, latencyMs, null, null);
  }
}
