package com.drawe.backend.domain.reference.dto;

import java.util.List;

/**
 * 레퍼런스 보드 검색 응답.
 *
 * @param source 적용된 필터 칩(ALL/AI/PHOTO/ARCHIVE)
 * @param blocked 관련성 가드로 결과를 비운 경우 true — 프론트가 "검색 결과 없음 + 생성 유도"를 이때 띄운다(빈 검색어·필터 결과 0 은 false)
 */
public record ReferenceBoardSearchResponse(
    List<ReferenceCard> results, int total, String query, String source, boolean blocked) {}
