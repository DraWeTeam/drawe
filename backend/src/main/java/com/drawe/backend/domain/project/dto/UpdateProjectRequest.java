package com.drawe.backend.domain.project.dto;

import jakarta.validation.constraints.Size;
import java.util.Map;

public record UpdateProjectRequest(
    @Size(max = 100) String name,
    @Size(max = 100) String subject,
    @Size(max = 30) String technique,
    @Size(max = 30) String mood,
    String description,
    String status,
    Map<String, Object> detailAnswers) {}
