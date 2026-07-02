package com.drawe.backend.domain.reference.dto;

import java.util.List;

/** 레퍼런스 보드 검색 응답. {@code source} 는 적용된 필터 칩(ALL/AI/PHOTO/ARCHIVE). */
public record ReferenceBoardSearchResponse(
    List<ReferenceCard> results, int total, String query, String source) {}
