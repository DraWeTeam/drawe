package com.drawe.backend.domain.search.dto;

import jakarta.validation.constraints.NotBlank;

public record SearchRequest(@NotBlank(message = "검색어는 비어있을 수 없습니다.") String query, Integer topK) {
  public int getTopK() {
    return topK != null && topK > 0 ? topK : 10;
  }
}
