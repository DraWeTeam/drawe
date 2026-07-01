package com.drawe.backend.domain.auth.controller;

import com.drawe.backend.domain.auth.dto.ChangePasswordRequest;
import com.drawe.backend.domain.auth.dto.FeedbackRequest;
import com.drawe.backend.domain.auth.dto.MyProfileResponse;
import com.drawe.backend.domain.auth.dto.UpdateNicknameRequest;
import com.drawe.backend.domain.auth.service.FeedbackService;
import com.drawe.backend.domain.auth.service.UserService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/user")
@RequiredArgsConstructor
public class UserController {

  private final UserService userService;
  private final FeedbackService feedbackService;

  @GetMapping("/profile")
  public ApiResponse<MyProfileResponse> me(@AuthenticationPrincipal PrincipalDetails user) {
    return ApiResponse.success(userService.getProfile(user.getUser().getId()));
  }

  /** 닉네임 변경. 갱신된 프로필을 반환한다. */
  @PatchMapping("/profile")
  public ApiResponse<MyProfileResponse> updateProfile(
      @AuthenticationPrincipal PrincipalDetails user,
      @Valid @RequestBody UpdateNicknameRequest request) {
    return ApiResponse.success(userService.updateNickname(user.getUser().getId(), request));
  }

  /** 비밀번호 변경 (소셜 계정은 거부). */
  @PostMapping("/password")
  public ApiResponse<Void> changePassword(
      @AuthenticationPrincipal PrincipalDetails user,
      @Valid @RequestBody ChangePasswordRequest request) {
    userService.changePassword(user.getUser().getId(), request);
    return ApiResponse.success();
  }

  /** 회원탈퇴 (soft delete). */
  @DeleteMapping
  public ApiResponse<Void> withdraw(@AuthenticationPrincipal PrincipalDetails user) {
    userService.withdraw(user.getUser().getId());
    return ApiResponse.success();
  }

  /** 사용자 피드백 — 운영 이메일로 전달 (DB 저장 없음). */
  @PostMapping("/feedback")
  public ApiResponse<Void> sendFeedback(
      @AuthenticationPrincipal PrincipalDetails user, @Valid @RequestBody FeedbackRequest request) {
    feedbackService.sendFeedback(user.getUser().getId(), request);
    return ApiResponse.success();
  }
}
