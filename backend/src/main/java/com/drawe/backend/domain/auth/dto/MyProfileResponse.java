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
}
