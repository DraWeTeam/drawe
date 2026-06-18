package com.drawe.backend.domain.auth.dto;

import jakarta.validation.constraints.AssertTrue;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class AgreeTermsRequest {

  @AssertTrue(message = "이용약관에 동의해야 합니다")
  private boolean agreeTerms;

  @AssertTrue(message = "개인정보 수집·이용에 동의해야 합니다")
  private boolean agreePrivacy;

  @AssertTrue(message = "만 14세 이상만 가입할 수 있습니다")
  private boolean agreeAge;
}
