package com.drawe.backend.domain.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class MyProfileResponse {
  private Long id;
  private String email;
  private String nickname;
  private String picture;
  private boolean termsAgreed; // 약관 동의 완료 여부 (termsAgreeAt != null)
  private String plan; // 요금제 코드 (free / paid)
  private boolean social; // 소셜 로그인 계정 여부 (password == null) — 비밀번호 변경 UI 표시 분기
}
