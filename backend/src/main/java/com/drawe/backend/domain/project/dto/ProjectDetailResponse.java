package com.drawe.backend.domain.project.dto;

import com.drawe.backend.domain.Project;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record ProjectDetailResponse(
    Long id,
    String name,
    String subject,
    String technique,
    String mood,
    List<String> keywords,
    String lastReferenceQuery,
    String description,
    String status,
    String drawingUrl,
    String coverImageUrl,
    String coverImageName,
    Long coverImageSize,
    Boolean suggestionsShown,
    List<BoardItem> board,
    Instant createdAt,
    Instant updatedAt) {

  /** coverImageUrl 은 브라우저 노출용으로 이미 서명된 값을 받는다(서비스에서 sign). */
  public static ProjectDetailResponse from(Project p, String coverImageUrl, List<BoardItem> board) {
    return new ProjectDetailResponse(
        p.getId(),
        p.getName(),
        p.getSubject(),
        p.getTechnique(),
        p.getMood(),
        p.getKeywords(),
        p.getLastReferenceQuery(),
        p.getDescription(),
        p.getStatus().name().toLowerCase(),
        p.getDrawingUrl(),
        coverImageUrl,
        p.getCoverImageName(),
        p.getCoverImageSize(),
        p.getSuggestionsShown(),
        board,
        p.getCreatedAt(),
        p.getUpdatedAt());
  }

  public record BoardItem(
      Long id, String url, String technique, String subject, String mood, Instant addedAt) {}
}
