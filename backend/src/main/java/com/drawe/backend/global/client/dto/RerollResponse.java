package com.drawe.backend.global.client.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import java.util.List;

/**
 * FastAPI guide 서비스의 {@code POST /reroll} 응답 계약. snake_case → camelCase(SnakeCaseStrategy), 미지 필드
 * 무시. 세 형태: 정상(hits) / 고갈(exhausted=true) / 생성 중(pending). LLM 미경유(참조검색만).
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public record RerollResponse(
    String subProblem, boolean exhausted, List<Hit> hits, Pending pending) {

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Hit(String refId, Double score, String url, GuideResponse.ReferenceMeta meta) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Pending(String jobId, String message) {}
}
