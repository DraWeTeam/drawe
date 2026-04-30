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
    long referenceCount,
    Instant createdAt,
    Instant updatedAt) {

  public static ProjectListItem of(Project p, long referenceCount) {
    return new ProjectListItem(
        p.getId(),
        p.getName(),
        p.getTechnique(),
        p.getStatus().name().toLowerCase(),
        referenceCount,
        p.getCreatedAt(),
        p.getUpdatedAt());
  }
}
