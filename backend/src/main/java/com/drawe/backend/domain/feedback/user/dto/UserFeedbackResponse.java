package com.drawe.backend.domain.feedback.user.dto;

/**
 * 피드백 제출 응답 — 저장된 레코드 ID 만 반환.
 *
 * @param id user_feedback.id (SoT 레코드 식별자).
 */
public record UserFeedbackResponse(Long id) {}
