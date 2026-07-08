package com.drawe.backend.domain.admin.dto;

import java.util.List;
import java.util.Locale;

/**
 * 어드민 Overview 탭 KPI 묶음 — 비즈니스(사용량) 지표만.
 *
 * <p>시스템 건강도(응답 지연·에러율의 원인·error_class)는 observability(Tempo/Prometheus/Loki)로 분리됨. 여기엔 "누가·얼마나
 * 썼나 + 시스템 실패가 났나(규모만)"만 남긴다 — 전부 {@code analytics_events} 단일 테이블 집계.
 *
 * <p>비율(success/error/searchBlock)은 분모 0일 때 {@code null} → 뷰에서 "—" 로 렌더한다. 임계·강조 판정은 raw {@code
 * Double} 값으로 뷰에서 한다. 원인·예외 종류(error_class)·지연 분위수(P95)는 여기서 다루지 않는다.
 */
public record OverviewKpi(
    int windowHours,
    String generatedAtText, // KST 표기용 (Instant를 서비스에서 포맷)
    long activeUsers,
    long chatStart,
    long chatSuccess, // 채팅 성공 턴 수 (사용량)
    long chatError, // 채팅 에러 턴 수 (시스템 실패 규모)
    long searchExecuted, // 검색 실행 수 (사용량)
    long searchBlocked, // 검색 차단 수 (무관 판단)
    Double successRate, // chat_success / (success + error) · 0~100, 분모 0이면 null
    Double errorRate, // chat_error / (success + error)
    Double searchBlockRate, // search_blocked / (executed + blocked)
    List<EventTypeCount> eventDistribution) {

  /** 이벤트 타입별 발생 수. */
  public record EventTypeCount(String eventType, long count) {}

  private static String pct(Double v) {
    return v == null ? "—" : String.format(Locale.US, "%.1f%%", v);
  }

  /** 뷰용 포맷 — 분모 0이면 "—". */
  public String successRateText() {
    return pct(successRate);
  }

  public String errorRateText() {
    return pct(errorRate);
  }

  public String searchBlockRateText() {
    return pct(searchBlockRate);
  }
}
