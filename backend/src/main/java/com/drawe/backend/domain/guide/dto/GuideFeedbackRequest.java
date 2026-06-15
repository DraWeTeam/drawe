package com.drawe.backend.domain.guide.dto;

/**
 * 가이드 전체 피드백 요청. {@code feedback} ∈ {"like", "dislike", null}. null/빈 값은 토글 해제(기존 피드백 삭제)를 의미한다.
 */
public record GuideFeedbackRequest(String feedback) {}
