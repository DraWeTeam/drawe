package com.drawe.backend.domain.project.dto;

import java.util.List;

public record ProjectListResponse(List<ProjectListItem> projects, long total, boolean hasMore) {}
