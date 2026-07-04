package com.drawe.backend.domain.reference.enums;

/**
 * 레퍼런스 보드 검색의 소스 필터 칩(전체/AI/사진/아카이브). UI 칩과 1:1.
 *
 * <p>PHOTO·AI 는 CLIP 의미검색 결과를 {@link com.drawe.backend.domain.enums.ImageSource} 로 필터링하고, ARCHIVE 는
 * 사용자가 저장한 {@code ProjectReference}(아카이브)를 키워드로 검색하는 별도 경로다. 일러스트(ILLUSTRATION)는 현재 시스템에 사진/일러스트
 * 구분이 없어 보류(SCRUM-113 범위 외).
 */
public enum ReferenceSource {
  ALL,
  AI,
  PHOTO,
  ARCHIVE;

  /** 대소문자·오타에 관대하게 파싱. 알 수 없으면 ALL. */
  public static ReferenceSource from(String v) {
    if (v == null || v.isBlank()) {
      return ALL;
    }
    try {
      return valueOf(v.trim().toUpperCase());
    } catch (IllegalArgumentException e) {
      return ALL;
    }
  }

  /**
   * CLIP 검색 결과를 거를 {@link com.drawe.backend.domain.enums.ImageSource} 이름. ALL/ARCHIVE 는 이 필터를 쓰지 않아
   * null.
   */
  public String imageSourceName() {
    return switch (this) {
      case AI -> "AI";
      case PHOTO -> "UNSPLASH";
      default -> null;
    };
  }
}
