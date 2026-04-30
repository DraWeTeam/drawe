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
    String description,
    String status,
    String drawingUrl,
    Boolean suggestionsShown,
    List<BoardItem> board,
    Instant createdAt,
    Instant updatedAt) {

  public static ProjectDetailResponse from(Project p, List<BoardItem> board) {
    return new ProjectDetailResponse(
        p.getId(),
        p.getName(),
        p.getSubject(),
        p.getTechnique(),
        p.getMood(),
        p.getDescription(),
        p.getStatus().name().toLowerCase(),
        p.getDrawingUrl(),
        p.getSuggestionsShown(),
        board,
        p.getCreatedAt(),
        p.getUpdatedAt());
  }

  public record BoardItem(
      Long id, String url, String technique, String subject, String mood, Instant addedAt) {}
}
