package com.drawe.backend.domain.collection.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 레퍼런스 저장 시 CLIP 자동분류 '추천'(레벨3) — 저장은 하지 않고 추천만. 사용자가 아카이브 메뉴에서 추천 컬렉션을 프리셀렉트로 보게 한다.
 *
 * @param axisId 추천 축 id(예 value_structure) — 추천 없으면 null
 * @param axisLabel 축 한글 라벨(예 명암 대비) — 추천 컬렉션 이름 후보. 추천 없으면 null
 * @param collectionId 이미 존재하는 그 축 컬렉션 id — 없으면 null(새로 만들어야 함)
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ReferenceSuggestionResponse(String axisId, String axisLabel, Long collectionId) {

  public static ReferenceSuggestionResponse none() {
    return new ReferenceSuggestionResponse(null, null, null);
  }
}
