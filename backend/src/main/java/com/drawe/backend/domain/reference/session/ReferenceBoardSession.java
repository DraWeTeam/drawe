package com.drawe.backend.domain.reference.session;

import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 레퍼런스 보드의 검색 세션 단기상태(Redis 저장). 챗 세션({@code SessionData})과 완전히 분리된 별도 세션.
 *
 * <ul>
 *   <li>{@code shownImageIds} — 이번 세션에서 이미 노출한 이미지(재검색·더보기 시 "새로 노출" 위해 제외)
 *   <li>{@code dislikeCount} — 싫어요 누적(3회 도달 시 생성 유도 모달 트리거, ack 시 리셋)
 * </ul>
 */
@Getter
@Setter
@NoArgsConstructor
public class ReferenceBoardSession {

  private Long userId;
  private Long projectId;
  private Set<Long> shownImageIds = new LinkedHashSet<>();
  private int dislikeCount;
  private Instant lastUpdatedAt;

  public static ReferenceBoardSession start(Long userId, Long projectId) {
    ReferenceBoardSession s = new ReferenceBoardSession();
    s.userId = userId;
    s.projectId = projectId;
    s.lastUpdatedAt = Instant.now();
    return s;
  }

  public void markShown(Collection<Long> ids) {
    shownImageIds.addAll(ids);
    lastUpdatedAt = Instant.now();
  }

  public int incrementDislike() {
    lastUpdatedAt = Instant.now();
    return ++dislikeCount;
  }

  public void resetDislike() {
    dislikeCount = 0;
    lastUpdatedAt = Instant.now();
  }
}
