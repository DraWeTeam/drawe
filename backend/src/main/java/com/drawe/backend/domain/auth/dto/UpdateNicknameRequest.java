package com.drawe.backend.domain.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class UpdateNicknameRequest {

  @NotBlank(message = "닉네임은 필수입니다")
  @Size(max = 100, message = "닉네임은 100자 이하여야 합니다")
  private String nickname;
}
