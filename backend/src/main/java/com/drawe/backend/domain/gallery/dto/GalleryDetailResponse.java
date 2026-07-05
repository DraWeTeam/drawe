package com.drawe.backend.domain.gallery.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

/**
 * 완성작 상세(회고) 응답 — 한 완성 프로젝트의 가이드 히스토리를 집계해 성장 서사·타임라인·프로세스 갤러리로 조립한다.
 *
 * <p>additive read-only 계약. 모든 라벨 매핑(axisId → 한국어)은 프론트가 처리한다. Spring 은 집계·순수 통과만.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record GalleryDetailResponse(
    Overview overview,
    List<TrendGroup> weeklyTrend,
    List<String> recurringTop, // axisId 최대 3 (라벨매핑은 프론트)
    List<String> improvedItems, // axisId
    List<TimelineEvent> timeline,
    List<ProcessShot> processGallery,
    List<TopReference> topReferences,
    List<QuestionPhase> questionGrowth,
    Summary summary // null 가능
    ) {

  public record Overview(
      String projectName,
      String representativeImageUrl,
      Instant createdAt,
      Instant completedAt,
      int workDays,
      int guideCount,
      int referenceCount,
      int drawingCount) {}

  // group: "전체"|"형태"|"구조"|"표현"|"연출"
  public record TrendGroup(String group, List<Point> points) {}

  // label "MM.dd"
  public record Point(String label, int count) {}

  // date "yyyy-MM-dd", type sketch|guide|reference|complete
  public record TimelineEvent(String date, String label, String thumbUrl, String type) {}

  // date "yyyy-MM-dd"
  public record ProcessShot(String date, String thumbUrl, String label) {}

  // name·tags = referenceMeta(category/personas) 조합. tags = 정본 태그 칩(예 명암·인물·측광).
  public record TopReference(
      String refId, String url, int count, String name, java.util.List<String> tags) {}

  // phase "초기"|"중기"|"후기"
  public record QuestionPhase(String phase, String date, String text) {}

  public record Summary(String axisId, int firstWeekHits, int lastWeekHits) {}
}
