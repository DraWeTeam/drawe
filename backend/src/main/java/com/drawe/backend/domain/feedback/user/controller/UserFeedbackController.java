package com.drawe.backend.domain.feedback.user.controller;

import com.drawe.backend.domain.feedback.user.dto.UserFeedbackRequest;
import com.drawe.backend.domain.feedback.user.dto.UserFeedbackResponse;
import com.drawe.backend.domain.feedback.user.service.UserFeedbackService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 사용자 자유서술 피드백 제출. 기존 JWT 인증 체인(anyRequest().authenticated()) 하에서 동작. */
@RestController
@RequestMapping("/feedback")
@RequiredArgsConstructor
public class UserFeedbackController {

  private final UserFeedbackService feedbackService;

  @PostMapping
  public ResponseEntity<ApiResponse<UserFeedbackResponse>> submit(
      @AuthenticationPrincipal PrincipalDetails principal,
      @Valid @RequestBody UserFeedbackRequest request) {

    UserFeedbackResponse response = feedbackService.submit(principal.getUser(), request);
    return ResponseEntity.ok(ApiResponse.success(response));
  }
}
