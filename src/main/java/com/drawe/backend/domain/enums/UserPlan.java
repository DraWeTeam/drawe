package com.drawe.backend.domain.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum UserPlan {
  FREE("free"),
  PAID("paid");

  private final String code;
}
