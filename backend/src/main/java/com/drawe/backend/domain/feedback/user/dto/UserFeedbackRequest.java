package com.drawe.backend.domain.feedback.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 사용자 피드백 제출 요청.
 *
 * @param body 자유서술 본문 (필수, 최대 2000자). blank 면 400.
 * @param turnCount 제출 시점의 채팅 누적 턴 수 (선택).
 * @param sessionId 피드백을 유발한 채팅 세션 ID (선택). 채팅 이벤트와 동일하게 프론트가 보유한 세션 UUID.
 */
public record UserFeedbackRequest(
    @NotBlank(message = "피드백 내용을 입력해주세요.") @Size(max = 2000, message = "피드백은 2000자 이내로 입력해주세요.")
        String body,
    Integer turnCount,
    String sessionId) {}
