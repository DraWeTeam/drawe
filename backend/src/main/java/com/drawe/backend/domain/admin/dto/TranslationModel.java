package com.drawe.backend.domain.admin.dto;

import java.util.List;

/**
 * 번역 실패 탭 모델. {@code prompt_translation_logs} 집계.
 *
 * <p>PII: {@code ko_prompt}(사용자 원문 한국어)·{@code en_prompt}는 절대 조회/표시하지 않는다. 상태 분포와 실패 사유 ({@code
 * error_message}) 집계만 — admin-log-guide §5.
 */
public final class TranslationModel {

  private TranslationModel() {}

  public record Kpi(
      int windowHours,
      String generatedAtText,
      long total,
      long success,
      long fallback, // FALLBACK_RAW
      long failed, // FAILED
      Double successRate,
      Double fallbackRate,
      Double failedRate) {}

  /** 실패/폴백 사유 한 줄. */
  public record FailureRow(String reason, String status, long count, String lastAtText) {}

  public record View(Kpi kpi, List<FailureRow> failures) {}
}
