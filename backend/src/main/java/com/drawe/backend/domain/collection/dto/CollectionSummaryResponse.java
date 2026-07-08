package com.drawe.backend.domain.collection.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/** 아카이브 목록(SCR-ARCH-02) 컬렉션 카드용 요약. thumbnails = 4분할 썸네일용 앞 최대 4개 이미지 url, count = 총 레퍼런스 수. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record CollectionSummaryResponse(List<CollectionCard> collections) {

  public record CollectionCard(
      Long id, String name, List<String> tags, int count, List<String> thumbnails) {}
}
