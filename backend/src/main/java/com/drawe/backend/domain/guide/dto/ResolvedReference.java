package com.drawe.backend.domain.guide.dto;

import java.util.List;

/**
 * 가이드 단위로 보강된 레퍼런스 한 컷: 순번(1·2·3) + ref_id + 브라우저 도달용 이미지 URL + ④ badge용 메타(원값).
 *
 * <p>sourceType/region/personas/category 는 fastapi reference_meta 원값 그대로 — 한글 라벨 변환은 프론트가 담당(라벨 정책
 * 변경 시 프론트만 수정). 메타 없으면 null / 빈 리스트.
 */
public record ResolvedReference(
    int ordinal,
    String refId,
    String url,
    String sourceType,
    String region,
    List<String> personas,
    String category) {}
