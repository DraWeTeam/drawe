package com.drawe.backend.domain.llm.dto;

import com.drawe.backend.domain.enums.MessageRole;
import java.util.List;

/**
 * LLM 구현체에 전달할 호출 컨텍스트(히스토리 + 새 입력).
 *
 * <p>{@code responseSchemaName} 은 Structured Output 강제용(S2' Phase 3) — null 이면 평문 응답, 비어있지 않으면 구현체가
 * 네이티브 스키마 모드를 요청한다(예: Grok {@code response_format:json_schema}). COMPOSE 만 스키마를 쓰고
 * TRANSLATE/KeywordExtractor 등은 평문이어야 하므로 호출별로 선택 가능해야 한다. 설계: {@code
 * docs/decisions/S2A-output-contract-design.md} §4.
 */
public record LlmCallContext(
    List<Turn> history,
    String newPrompt,
    byte[] imageBytes,
    String imageMimeType,
    String responseSchemaName,
    String conversationId) {

  /**
   * 평문 응답(스키마 없음) 편의 생성자 — 기존 호출 지점(TRANSLATE·KeywordExtractor·레거시 chat)이 그대로 쓴다. conversationId 도
   * null(=헤더 미부착).
   */
  public LlmCallContext(
      List<Turn> history, String newPrompt, byte[] imageBytes, String imageMimeType) {
    this(history, newPrompt, imageBytes, imageMimeType, null, null);
  }

  /**
   * 스키마 지정·conversationId 미지정 편의 생성자 — 기존 5-arg 호출 지점 호환. conversationId 는 멀티턴 캐시 라우팅이 의미있는 COMPOSE
   * 경로만 채운다(Grok {@code x-grok-conv-id}).
   */
  public LlmCallContext(
      List<Turn> history,
      String newPrompt,
      byte[] imageBytes,
      String imageMimeType,
      String responseSchemaName) {
    this(history, newPrompt, imageBytes, imageMimeType, responseSchemaName, null);
  }

  public record Turn(MessageRole role, String content) {}
}
