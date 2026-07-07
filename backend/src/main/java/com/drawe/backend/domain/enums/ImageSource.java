package com.drawe.backend.domain.enums;

public enum ImageSource {
  UNSPLASH,
  AI,
  // 가이드 §4 추천 레퍼런스(FastAPI 코퍼스, UUID)를 아카이브로 인제스트할 때의 출처. sourceId=코퍼스 refId(UUID).
  GUIDE_REF
}
