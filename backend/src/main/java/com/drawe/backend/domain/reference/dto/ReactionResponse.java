package com.drawe.backend.domain.reference.dto;

/**
 * 좋아요/싫어요/취소 응답.
 *
 * @param imageId 대상 이미지
 * @param reaction "LIKE" | "DISLIKE" | null(취소)
 * @param dislikeCount 현재 세션 싫어요 누적
 * @param suggestGeneration 싫어요 임계(3회) 도달 → 프론트가 "가이드/레퍼런스 생성" 유도 모달을 띄우라는 신호
 */
public record ReactionResponse(
    Long imageId, String reaction, int dislikeCount, boolean suggestGeneration) {}
