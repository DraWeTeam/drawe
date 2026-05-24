package com.drawe.backend.domain.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateProjectRequest(
    @NotBlank @Size(max = 100) String name,
    @NotBlank @Size(max = 100) String subject,
    @Size(max = 30) String technique,
    @Size(max = 30) String mood,
    String description) {}
