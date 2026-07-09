package com.drawe.backend.domain.project.controller;

import com.drawe.backend.domain.User;
import com.drawe.backend.domain.analytics.AnalyticsEventType;
import com.drawe.backend.domain.analytics.service.AnalyticsEventService;
import com.drawe.backend.domain.enums.ProjectSort;
import com.drawe.backend.domain.project.dto.CreateProjectRequest;
import com.drawe.backend.domain.project.dto.KeywordExtractionRequest;
import com.drawe.backend.domain.project.dto.KeywordExtractionResponse;
import com.drawe.backend.domain.project.dto.ProjectDetailResponse;
import com.drawe.backend.domain.project.dto.ProjectListResponse;
import com.drawe.backend.domain.project.dto.UpdateProjectRequest;
import com.drawe.backend.domain.project.service.ProjectKeywordService;
import com.drawe.backend.domain.project.service.ProjectService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
@RequestMapping("/projects")
@RequiredArgsConstructor
@Validated
public class ProjectController {

  private final ProjectService projectService;
  private final ProjectKeywordService projectKeywordService;
  private final AnalyticsEventService analyticsEventService;

  /** 1단계 — 주제 문장에서 프로젝트 이름 + 키워드 칩 추출(사용자 편집 전). */
  @PostMapping("/keyword-extraction")
  public ApiResponse<KeywordExtractionResponse> keywordExtraction(
      @AuthenticationPrincipal PrincipalDetails principal,
      @Valid @RequestBody KeywordExtractionRequest request) {
    KeywordExtractionResponse result = projectKeywordService.extract(request.topic());
    trackChipShown(principal, request.topic(), result.keywords());
    return ApiResponse.success(result);
  }

  /**
   * AI 추천 키워드 칩 노출 계측(chip_shown). <b>부가 기능</b> — 계측이 실패해도 추출 응답은 정상 반환되게 감싼다.
   *
   * <p>{@code analyticsEventService.track} 자체가 REQUIRES_NEW + 내부 try-catch 지만, payload 구성 단계의 예외까지
   * 방어한다. Grok degrade 로 keywords 가 비면 chips 빈 배열로 발화(노출 시도 자체는 chip_count=0 으로 기록). 라벨은 원본 그대로
   * 저장하고 정규화는 집계 시점에 한다.
   */
  private void trackChipShown(PrincipalDetails principal, String topic, List<String> keywords) {
    try {
      List<String> kws = keywords == null ? List.of() : keywords;
      List<Map<String, Object>> chips = new ArrayList<>(kws.size());
      for (int i = 0; i < kws.size(); i++) {
        Map<String, Object> chip = new HashMap<>();
        chip.put("label", kws.get(i));
        chip.put("position", i);
        chips.add(chip);
      }
      Map<String, Object> payload = new HashMap<>();
      payload.put("source", "ai_keyword");
      payload.put("chips", chips);
      payload.put("chip_count", kws.size());
      payload.put("topic_len", topic == null ? 0 : topic.length());

      User user = principal != null ? principal.getUser() : null;
      analyticsEventService.track(AnalyticsEventType.CHIP_SHOWN, user, null, payload);
    } catch (Exception e) {
      log.warn("chip_shown 계측 실패(무시): error_class={}", e.getClass().getSimpleName());
    }
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public ApiResponse<ProjectDetailResponse> create(
      @AuthenticationPrincipal PrincipalDetails principal,
      @Valid @RequestBody CreateProjectRequest request) {
    return ApiResponse.success(projectService.create(principal.getUser(), request));
  }

  @GetMapping
  public ApiResponse<ProjectListResponse> list(
      @AuthenticationPrincipal PrincipalDetails principal,
      @RequestParam(required = false) String q,
      @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "RECENT") ProjectSort sort,
      @RequestParam(defaultValue = "20") @Min(1) int limit,
      @RequestParam(defaultValue = "0") @Min(0) int offset) {
    return ApiResponse.success(
        projectService.getList(principal.getUser(), q, status, sort, limit, offset));
  }

  @GetMapping("/{projectId}")
  public ApiResponse<ProjectDetailResponse> detail(
      @AuthenticationPrincipal PrincipalDetails principal, @PathVariable Long projectId) {
    return ApiResponse.success(projectService.getDetail(principal.getUser(), projectId));
  }

  @PatchMapping("/{projectId}")
  public ApiResponse<Map<String, Boolean>> update(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @Valid @RequestBody UpdateProjectRequest request) {
    projectService.update(principal.getUser(), projectId, request);
    return ApiResponse.success(Map.of("success", true));
  }

  @DeleteMapping("/{projectId}")
  public ApiResponse<Map<String, Boolean>> delete(
      @AuthenticationPrincipal PrincipalDetails principal, @PathVariable Long projectId) {
    projectService.delete(principal.getUser(), projectId);
    return ApiResponse.success(Map.of("success", true));
  }
}
