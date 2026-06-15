package com.drawe.backend.domain.guide.dto;

/** 가이드 단위로 보강된 레퍼런스 한 컷: 순번(1·2·3) + ref_id + 브라우저 도달용 이미지 URL. */
public record ResolvedReference(int ordinal, String refId, String url) {}
