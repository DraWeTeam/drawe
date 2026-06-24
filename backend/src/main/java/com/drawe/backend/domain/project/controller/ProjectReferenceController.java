package com.drawe.backend.domain.project.controller;

import com.drawe.backend.domain.project.dto.ReferenceAddRequest;
import com.drawe.backend.domain.project.service.ProjectReferenceService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/projects/{projectId}/references")
@RequiredArgsConstructor
@Tag(name = "ProjectReference", description = "프로젝트 레퍼런스 아카이브 API")
public class ProjectReferenceController {

  private final ProjectReferenceService projectReferenceService;

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(summary = "레퍼런스 저장", description = "이미지를 프로젝트 레퍼런스 아카이브에 저장합니다. 중복 저장은 멱등 처리됩니다.")
  public ApiResponse<Map<String, Boolean>> add(
      @AuthenticationPrincipal PrincipalDetails principalDetails,
      @PathVariable Long projectId,
      @Valid @RequestBody ReferenceAddRequest request) {
    projectReferenceService.addReference(principalDetails.getUser(), projectId, request.imageId());
    return ApiResponse.success(Map.of("success", true));
  }
}
