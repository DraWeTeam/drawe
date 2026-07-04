package com.drawe.backend.domain.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class FeedbackRequest {

  @NotBlank(message = "내용을 입력해주세요")
  @Size(max = 2000, message = "내용은 2000자 이하여야 합니다")
  private String message;
}
