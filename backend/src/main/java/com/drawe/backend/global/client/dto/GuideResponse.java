package com.drawe.backend.global.client.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import java.util.List;
import java.util.Map;

/**
 * FastAPI guide 서비스의 /guide 응답 계약(= Frontend ↔ Spring ↔ FastAPI 공유 형태).
 *
 * <p>fastapi JSON 은 snake_case 이므로 record 필드(camelCase)에 SnakeCaseStrategy 를 적용한다. 알 수 없는 필드는 무시(전방
 * 호환). 비-coach(refused/redirect/clarify)는 mode + message(+reason)만 채워진다.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public record GuideResponse(
    String mode, // coach | redirect | clarify | refused
    String guideId,
    String primaryFocus,
    boolean degraded,
    List<GuideBlock> blocks,
    String synthesis,
    // 채팅 한 줄 피드백(fastapi 결정론 조립: intent-aware 프레이밍 + 현재 그림 진단). SnakeCaseStrategy 로
    //   chat_feedback ↔ chatFeedback 매핑. Spring 은 순수 통과(생성·가공 0) — 값은 fastapi 가 만든 그대로.
    String chatFeedback,
    String oneThing,
    String message,
    NextSteps nextSteps,
    Growth growth,
    String reason,
    String nextStepsNote,
    // ④ 추천 레퍼런스 badge용 메타(ref_id → source_type/region/personas/category). fastapi 표시 전용, 순수 통과.
    Map<String, ReferenceMeta> referenceMeta) {

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record ReferenceMeta(
      String sourceType, String region, List<String> personas, String category) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GuideBlock(
      String subProblem,
      String observation,
      String effect,
      String direction,
      List<String> referenceIds,
      Double confidence,
      GuideAsset guideAsset) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GuideAsset(String type, String refId, String label, String caption) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record NextSteps(
      String focus,
      String focusPractice,
      String nextGoal,
      String nextGoalPractice,
      List<String> recurring,
      String why,
      String note,
      GuideAsset focusAsset,
      // ⑥ 5단계 커리큘럼 트랙(그룹·정본 5단계 라벨·현재 단계). fastapi track_map.yaml 단일 소스 —
      //   Spring 은 순수 통과(생성·라벨 정의 0), 프론트는 받은 것만 프로그레스 바로 렌더.
      Track track) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Track(String group, List<String> stages, Integer currentIdx) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Growth(
      String narration,
      RecurringStat recurringStat,
      List<TrendPoint> trend,
      String deltaNote,
      Chips chips) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record RecurringStat(String subProblem, Integer window, Integer hits, Double ratio) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record TrendPoint(Integer index, String label, Integer difficultyCount) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Chips(List<String> currentStageAxes, List<String> improvingAxes) {}
}
