package com.drawe.backend.domain.project.dto;

import jakarta.validation.constraints.NotNull;

public record ReferenceAddRequest(@NotNull Long imageId) {}
