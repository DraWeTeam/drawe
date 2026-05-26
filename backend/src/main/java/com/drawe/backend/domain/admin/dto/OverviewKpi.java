package com.drawe.backend.domain.admin.dto;

import java.util.List;

/**
 * 어드민 Overview 탭에 뿌릴 KPI 묶음.
 *
 * <p>전부 {@code analytics_events} 단일 테이블 집계에서 나온다 (Phase 1 범위). 비율 필드(rate)는 분모가 0이면 {@code null} —
 * 화면에서 "—"로 표기. 지연(latency) 필드도 표본이 없으면 {@code null}.
 */
public record OverviewKpi(
    int windowHours,
    String generatedAtText, // KST 표기용 (Instant를 서비스에서 포맷)
    long activeUsers,
    long chatStart,
    long chatSuccess,
    long chatError,
    Double chatSuccessRate, // 0.0~1.0
    long searchExecuted,
    long searchBlocked,
    Double searchBlockRate, // 0.0~1.0
    Long latencyAvgMs,
    Long latencyP50Ms,
    Long latencyP95Ms,
    Long latencyMaxMs,
    long latencySampleCount,
    List<EventTypeCount> eventDistribution,
    List<ErrorClassCount> topErrors) {

  /** 이벤트 타입별 발생 수. */
  public record EventTypeCount(String eventType, long count) {}

  /** chat_error 의 error_class 별 발생 수. */
  public record ErrorClassCount(String errorClass, long count) {}
}
