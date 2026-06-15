package com.drawe.backend.domain.guide.controller;

import com.drawe.backend.domain.guide.dto.GuideResult;
import com.drawe.backend.domain.guide.service.GuideService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이미지 가이딩(한 끗 가이드) 전용 엔드포인트. 클립📎 업로드 모달이 호출.
 *
 * <p>멀티파트: file(필수) + message/intent/track/medium(선택). 멱등은 Idempotency-Key 헤더로.
 */
@RestController
@RequestMapping("/projects/{projectId}/guide")
@RequiredArgsConstructor
public class GuideController {

  private final GuideService guideService;

  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ApiResponse<GuideResult> guide(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @RequestPart("file") MultipartFile file,
      @RequestParam(value = "message", required = false) String message,
      @RequestParam(value = "intent", required = false) String intent,
      @RequestParam(value = "track", required = false) String track,
      @RequestParam(value = "medium", required = false) String medium,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ApiResponse.success(
        guideService.guide(
            principal.getUser(), projectId, file, message, intent, track, medium, idempotencyKey));
  }
}
