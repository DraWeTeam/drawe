package com.drawe.backend.domain.project.dto;

import com.drawe.backend.domain.Project;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record ProjectListItem(
    Long id,
    String name,
    String technique,
    String status,
    String coverImageUrl,
    long referenceCount,
    Instant createdAt,
    Instant updatedAt) {

  /** coverImageUrl 은 브라우저 노출용으로 이미 서명된 값을 받는다(서비스에서 sign). */
  public static ProjectListItem of(Project p, long referenceCount, String coverImageUrl) {
    return new ProjectListItem(
        p.getId(),
        p.getName(),
        p.getTechnique(),
        p.getStatus().name().toLowerCase(),
        coverImageUrl,
        referenceCount,
        p.getCreatedAt(),
        p.getUpdatedAt());
  }
}
