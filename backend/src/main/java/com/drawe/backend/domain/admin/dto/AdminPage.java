package com.drawe.backend.domain.admin.dto;

import java.util.List;

/**
 * 어드민 페이지네이션 공통 페이로드 — 행 목록 + 총건수 + 현재 페이지/사이즈 + 검색어 보존.
 *
 * <p>page는 1-based. 검색어 q는 null 대신 빈 문자열로 정규화해서 받음(템플릿·SQL 분기 단순화). 백로그·수요 등 여러 섹션에서 같은 패턴 재사용.
 * (FunnelPage 도 추후 이걸로 통합 가능.)
 */
public record AdminPage<T>(List<T> rows, long total, int page, int size, String q) {

  public int totalPages() {
    return (int) Math.max(1, (total + size - 1) / size);
  }

  public boolean hasPrev() {
    return page > 1;
  }

  public boolean hasNext() {
    return (long) page * size < total;
  }

  public int prevPage() {
    return Math.max(1, page - 1);
  }

  public int nextPage() {
    return page + 1;
  }
}
