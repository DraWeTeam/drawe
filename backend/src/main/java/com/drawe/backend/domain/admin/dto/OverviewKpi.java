package com.drawe.backend.domain.admin.dto;

import java.util.List;

/**
 * 어드민 Overview 탭 KPI 묶음 — 비즈니스(사용량) 지표만.
 *
 * <p>시스템 건강도(응답 지연·에러율·error_class)는 observability(Tempo/Prometheus/Loki)로 분리됨. 여기엔 "누가·얼마나 썼나"만
 * 남긴다 — 전부 {@code analytics_events} 단일 테이블 집계.
 */
public record OverviewKpi(
    int windowHours,
    String generatedAtText, // KST 표기용 (Instant를 서비스에서 포맷)
    long activeUsers,
    long chatStart,
    long chatSuccess, // 채팅 완료 수 (사용량)
    long searchExecuted, // 검색 실행 수 (사용량)
    List<EventTypeCount> eventDistribution) {

  /** 이벤트 타입별 발생 수. */
  public record EventTypeCount(String eventType, long count) {}
}
