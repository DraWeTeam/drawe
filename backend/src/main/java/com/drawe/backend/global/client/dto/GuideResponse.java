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
    Map<String, ReferenceMeta> referenceMeta,
    // #8 사용자 그림 위 개선 포인트 오버레이 SVG(개선 요청 모드일 때만; 이론 질문이면 null). fastapi
    //   _make_overlay 가 생성(좌표·번호 badge, 사용자 입력 없음). Spring 은 순수 통과 — 프론트가 OverlayImage 로 합성.
    String overlay,
    // #8 시각 모드 선택 결과(theory_axes=이론으로 설명할 축, overlay_axes=그림 위 표기할 축). 순수 통과.
    VisualMode visualMode,
    // 무드 가시화(표시 전용): 온보딩 무드 취향 persona_lean. fastapi 계산분 순수 통과 — 프론트가
    //   ref.personas 교집합 판정에만 사용(스코어링·부스트 무관). 무드 미설정이면 null.
    MoodProfile moodProfile) {

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record ReferenceMeta(
      String sourceType, String region, List<String> personas, String category) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record MoodProfile(List<String> personaLean) {}

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
      Chips chips,
      // 이번 프로젝트 '첫 가이드'(콜드스타트) 여부 — fastapi 가 계산. 프론트가 '처음 사용' 안내를 추세 부족 안내와
      //   구분하는 게이트로만 쓴다(순수 통과). 이 필드가 없으면 ignoreUnknown 로 드롭돼 프론트가 늘 '이력 부족'만 띄운다.
      Boolean first) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record RecurringStat(
      String subProblem,
      Integer window,
      Integer hits,
      Double ratio,
      // ⑦ 주별 요청 N→M 인사이트용 — recurring 축 초기/최근 활동주 요청 수(순수 통과, 프론트가 조립).
      Integer firstWeekHits,
      Integer lastWeekHits) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  // ⑦ weeklyCount = 그 주 가이드 요청 횟수(정본 그래프 Y). difficultyCount 는 하위호환 보존.
  public record TrendPoint(
      Integer index, String label, Integer difficultyCount, Integer weeklyCount) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Chips(List<String> currentStageAxes, List<String> improvingAxes) {}

  // #8 시각 모드 — fastapi select_visual_mode 결과. 프론트는 overlay 유무로 분기하므로 보조 정보(순수 통과).
  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record VisualMode(List<String> theoryAxes, List<String> overlayAxes) {}
}
