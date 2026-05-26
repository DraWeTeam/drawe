package com.drawe.backend.domain.admin.dto;

/**
 * Engagement Funnel 한 줄 — ref(이미지) 하나의 노출→좋아요/싫어요→저장.
 *
 * <p>rate는 "노출 대비"(of shown). shown이 0인 행은 조회되지 않으므로 rate는 항상 계산 가능.
 */
public record FunnelRow(
    long imageId,
    long shown,
    long likes,
    long dislikes,
    long saves,
    Double likeRate,
    Double dislikeRate,
    Double saveRate,
    String url,
    String source, // UNSPLASH / AI
    String photographer,
    String tagSummary) {}
