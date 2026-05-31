package com.drawe.backend.domain.admin.dto;

import java.util.List;

/**
 * Engagement Funnel 페이지 결과 — 페이지네이션 + 검색 메타.
 *
 * <p>page는 1-based. 다른 탭(시드 보강 백로그, 검색 수요 TOP)에도 같은 패턴으로 적용 가능하도록, 도메인 독립적인 헬퍼만 둠.
 */
public record FunnelPage(List<FunnelRow> rows, long total, int page, int size, String q) {

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
