package com.drawe.backend.domain.search.dto;

import java.util.List;

public record SearchResponse(
        List<ImageResult> results,
        int total,
        String query
) {
}
