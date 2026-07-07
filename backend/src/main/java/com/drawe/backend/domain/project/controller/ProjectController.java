package com.drawe.backend.domain.project.controller;

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
import java.util.Map;
import lombok.RequiredArgsConstructor;
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

@RestController
@RequestMapping("/projects")
@RequiredArgsConstructor
@Validated
public class ProjectController {

  private final ProjectService projectService;
  private final ProjectKeywordService projectKeywordService;

  /** 1단계 — 주제 문장에서 프로젝트 이름 + 키워드 칩 추출(사용자 편집 전). */
  @PostMapping("/keyword-extraction")
  public ApiResponse<KeywordExtractionResponse> keywordExtraction(
      @Valid @RequestBody KeywordExtractionRequest request) {
    return ApiResponse.success(projectKeywordService.extract(request.topic()));
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
