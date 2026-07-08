package com.drawe.backend.domain.collection.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

/**
 * 컬렉션 상세(SCR-ARCH-04) — 헤더(이름/태그) + 레퍼런스 그리드.
 *
 * <p>각 레퍼런스는 필터(전체/AI/사진/일러스트)용 {@code source}(UNSPLASH=사진, AI, GUIDE_REF=일러스트)와 고정 여부를 담는다.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record CollectionDetailResponse(
    Long id,
    String name,
    String description,
    List<String> tags,
    List<ReferenceItem> references) {

  public record ReferenceItem(
      Long imageId,
      String url,
      String source,
      boolean pinned,
      Instant addedAt,
      List<String> keywords,
      List<String> userTags) {}
}
