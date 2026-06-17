package com.drawe.backend.global.client.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import java.util.List;

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
    String oneThing,
    String message,
    NextSteps nextSteps,
    Growth growth,
    String reason,
    String nextStepsNote) {

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
      GuideAsset focusAsset) {}

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
