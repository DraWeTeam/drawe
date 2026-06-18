package com.drawe.backend.domain.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class VerifyCodeRequest {

  @NotBlank @Email private String email;

  @NotBlank(message = "인증번호는 필수입니다.")
  private String code;
}
