package com.drawe.backend.domain.auth.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class SignupRequest {

  @NotBlank(message = "이메일은 필수입니다")
  @Email(message = "이메일 형식이 올바르지 않습니다")
  private String email;

  @NotBlank(message = "비밀번호는 필수입니다")
  @Size(min = 8, message = "비밀번호는 8자 이상이어야 합니다")
  private String password;

  @NotBlank(message = "닉네임은 필수입니다")
  @Size(min = 2, max = 20, message = "닉네임은 2~20자여야 합니다")
  private String nickname;

  @AssertTrue(message="이용약관에 동의해야 합니다")
  private boolean agreeTerms;

  @AssertTrue(message="개인정보 수집·이용에 동의해야 합니다")
  private boolean agreePrivacy;

  @AssertTrue(message="만 14세 이상만 가입할 수 있습니다")
  private boolean agreeAge;

}
