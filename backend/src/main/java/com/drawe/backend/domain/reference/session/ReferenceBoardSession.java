package com.drawe.backend.domain.reference.session;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 레퍼런스 보드의 검색 세션 단기상태(Redis 저장). 챗 세션({@code SessionData})과 완전히 분리된 별도 세션.
 *
 * <ul>
 *   <li>{@code dislikeCount} — 싫어요 누적(3회 도달 시 생성 유도 모달 트리거, ack 시 리셋)
 * </ul>
 *
 * <p>검색 페이징은 프론트 클라 페이징("더보기")이 담당하므로, 서버 노출이력(shown)·직전 검색어 상태는 두지 않는다(검색=항상 상위 랭킹,
 * deterministic).
 */
@Getter
@Setter
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true) // 구버전 세션(shownImageIds/lastQuery 등) 역직렬화 안전
public class ReferenceBoardSession {

  private Long userId;
  private Long projectId;
  private int dislikeCount;
  private Instant lastUpdatedAt;

  public static ReferenceBoardSession start(Long userId, Long projectId) {
    ReferenceBoardSession s = new ReferenceBoardSession();
    s.userId = userId;
    s.projectId = projectId;
    s.lastUpdatedAt = Instant.now();
    return s;
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
