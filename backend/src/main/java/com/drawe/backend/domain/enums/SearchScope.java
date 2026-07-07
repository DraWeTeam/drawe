package com.drawe.backend.domain.enums;

/**
 * 전역 검색(SearchModal) 대상 범위. SCRUM-105.
 *
 * <ul>
 *   <li>{@code ALL} — 프로젝트/레퍼런스/완성작 갤러리 합본
 *   <li>{@code PROJECT} — 내 프로젝트(이름·주제·기법·분위기)
 *   <li>{@code REFERENCE} — 프로젝트에 담긴 레퍼런스 이미지(소속 프로젝트 + 이미지 태그)
 *   <li>{@code COMPLETED} — 완성작 갤러리(완성 처리된 프로젝트)
 * </ul>
 */
public enum SearchScope {
  ALL,
  PROJECT,
  REFERENCE,
  COMPLETED;

  /** 대소문자 무시 파싱. null/공백/미지원 값은 {@link #ALL} 로 폴백해 400 을 피한다. */
  public static SearchScope from(String raw) {
    if (raw == null || raw.isBlank()) {
      return ALL;
    }
    try {
      return SearchScope.valueOf(raw.trim().toUpperCase());
    } catch (IllegalArgumentException e) {
      return ALL;
    }
  }
}
