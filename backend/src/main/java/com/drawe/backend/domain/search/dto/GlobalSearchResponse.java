package com.drawe.backend.domain.search.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

/**
 * 전역 검색(SearchModal) 응답 — 대상 타입별 그룹. SCRUM-105.
 *
 * <p>선택 scope 의 그룹만 채우고 나머지는 빈 배열을 유지한다({@code @JsonInclude ALWAYS} — 프론트가 키 존재를 가정). 챗 의미검색({@code
 * SearchResponse})과 별개의 콘텐츠 텍스트 검색 응답이다.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record GlobalSearchResponse(
    List<ProjectHit> projects, List<ReferenceHit> references, List<CompletedHit> completed) {

  /** 프로젝트 검색 결과 한 건. */
  public record ProjectHit(
      Long id, String name, String technique, String status, Instant updatedAt) {}

  /** 레퍼런스(프로젝트에 담긴 이미지) 검색 결과 한 건 — 썸네일 + 소속 프로젝트 맥락. */
  public record ReferenceHit(Long imageId, String url, Long projectId, String projectName) {}

  /** 완성작 갤러리(완성 프로젝트) 검색 결과 한 건. */
  public record CompletedHit(
      Long projectId, String projectName, String drawingUrl, Instant completedAt) {}

  public static GlobalSearchResponse empty() {
    return new GlobalSearchResponse(List.of(), List.of(), List.of());
  }
}
