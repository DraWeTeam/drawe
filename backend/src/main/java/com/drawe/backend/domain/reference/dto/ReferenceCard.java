package com.drawe.backend.domain.reference.dto;

import com.drawe.backend.domain.search.dto.ImageResult;

/**
 * 레퍼런스 보드 카드 — 검색 이미지 + 현재 사용자 반응.
 *
 * @param image 검색/아카이브 이미지 메타(기존 {@link ImageResult} 재활용)
 * @param myReaction "LIKE" | null (싫어요는 검색에서 제외되므로 결과에 안 나옴)
 */
public record ReferenceCard(ImageResult image, String myReaction) {}
