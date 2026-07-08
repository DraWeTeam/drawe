package com.drawe.backend.domain.analytics.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 프론트가 발송하는 범용 analytics 이벤트 적재 요청.
 *
 * <p>{@code event_type} 은 컨트롤러의 화이트리스트로 통제한다 (임의 이벤트 적재 방지). 현재 허용: 피드백 깔때기 3종
 * (triggered/opened/submitted).
 *
 * @param eventType 이벤트 타입 (화이트리스트에 없으면 400).
 * @param sessionId 채팅 세션 ID (선택).
 * @param turnCount 이벤트 시점의 채팅 누적 턴 수 (선택). payload {@code turn_count} 로 적재.
 */
public record AnalyticsEventIngestRequest(
    @NotBlank(message = "event_type 은 필수입니다.") String eventType,
    String sessionId,
    Integer turnCount) {}
