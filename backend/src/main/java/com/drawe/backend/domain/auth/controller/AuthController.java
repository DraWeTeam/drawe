package com.drawe.backend.domain.auth.controller;

import com.drawe.backend.domain.auth.dto.*;
import com.drawe.backend.domain.auth.service.AuthService;
import com.drawe.backend.domain.auth.service.EmailVerificationService;
import com.drawe.backend.domain.auth.service.PasswordResetService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
@Validated
public class AuthController {

  private final AuthService authService;
  private final EmailVerificationService emailVerificationService;
  private final PasswordResetService passwordResetService;

  @Value("${spring.security.oauth2.client.registration.google.client-id}")
  private String clientId;

  @Value("${spring.security.oauth2.client.registration.google.redirect-uri}")
  private String redirectUri;

  @PostMapping("/signup")
  public ApiResponse<SignupResponse> signup(@Valid @RequestBody SignupRequest request) {
    return ApiResponse.success(authService.signup(request));
  }

  @PostMapping("/login")
  public ApiResponse<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
    return ApiResponse.success(authService.login(request));
  }

  @GetMapping("/google")
  public ApiResponse<Map<String, String>> getGoogleLoginUrl() {
    String scope = URLEncoder.encode("openid email profile", StandardCharsets.UTF_8);

    String googleLoginUrl =
        "https://accounts.google.com/o/oauth2/v2/auth"
            + "?client_id="
            + clientId
            + "&redirect_uri="
            + URLEncoder.encode(redirectUri, StandardCharsets.UTF_8)
            + "&response_type=code"
            + "&scope="
            + scope;

    return ApiResponse.success(Map.of("url", googleLoginUrl));
  }

  @PostMapping("/refresh")
  public ApiResponse<RefreshTokenResponse> refresh(
      @Valid @RequestBody RefreshTokenRequest request) {
    return ApiResponse.success(authService.refresh(request));
  }

  @PostMapping("/logout")
  public ApiResponse<Void> logout(@Valid @RequestBody RefreshTokenRequest request) {
    authService.logout(request);
    return ApiResponse.success();
  }

  @PostMapping("/logout/all")
  public ApiResponse<Void> logoutAll(@RequestHeader("Authorization") String authorizationHeader) {
    authService.logoutAll(authorizationHeader);
    return ApiResponse.success();
  }

  @GetMapping("/check-email")
  public ApiResponse<CheckAvailabilityResponse> checkEmail(
      @RequestParam @NotBlank @Email String email) {
    return ApiResponse.success(authService.checkEmail(email));
  }

  @GetMapping("/check-nickname")
  public ApiResponse<CheckAvailabilityResponse> checkNickname(
      @RequestParam @NotBlank String nickname) {
    return ApiResponse.success(authService.checkNickname(nickname));
  }

  @PostMapping("/check-password")
  public ApiResponse<Void> checkPassword(
      @AuthenticationPrincipal PrincipalDetails principalDetails,
      @Valid @RequestBody PasswordCheckRequest request) {
    authService.checkPassword(principalDetails.getUser().getId(), request);
    return ApiResponse.success();
  }

  @PostMapping("/agree-terms")
  public ApiResponse<Void> agreeTerms(
      @AuthenticationPrincipal PrincipalDetails principalDetails,
      @Valid @RequestBody AgreeTermsRequest request) {
    authService.agreeTerms(principalDetails.getUser().getId());
    return ApiResponse.success();
  }

  @PostMapping("/email/send-code")
  public ApiResponse<Void> sendCode(@Valid @RequestBody SendCodeRequest request) {
    emailVerificationService.sendCode(request.getEmail());
    return ApiResponse.success();
  }

  @PostMapping("/email/verify-code")
  public ApiResponse<Void> verifyCode(@Valid @RequestBody VerifyCodeRequest request) {
    emailVerificationService.verifyCode(request.getEmail(), request.getCode());
    return ApiResponse.success();
  }

  // ── 비밀번호 재설정 (SCR-AUTH-02~04): 이메일 인증코드 → 검증 → 새 비번 ──
  @PostMapping("/password-reset/send-code")
  public ApiResponse<Void> sendResetCode(@Valid @RequestBody SendCodeRequest request) {
    passwordResetService.sendResetCode(request.getEmail());
    return ApiResponse.success();
  }

  @PostMapping("/password-reset/verify-code")
  public ApiResponse<Void> verifyResetCode(@Valid @RequestBody VerifyCodeRequest request) {
    passwordResetService.verifyResetCode(request.getEmail(), request.getCode());
    return ApiResponse.success();
  }

  @PostMapping("/password-reset")
  public ApiResponse<Void> resetPassword(@Valid @RequestBody PasswordResetRequest request) {
    passwordResetService.resetPassword(request.getEmail(), request.getNewPassword());
    return ApiResponse.success();
  }
}
