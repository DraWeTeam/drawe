package com.drawe.backend.domain.project.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/**
 * 가이드 §4 추천 레퍼런스(FastAPI 코퍼스, UUID)를 아카이브로 인제스트하는 요청. 프론트가 이미 보유한 ResolvedReference 를 그대로 전달한다 —
 * backend 는 refId 로 원본 bytes 를 가져와 Image 로 만들고 ProjectReference 를 생성한다(멱등). meta 는 rawTags 로 보존.
 */
public record ReferenceIngestRequest(
    @NotBlank String refId,
    String sourceType,
    String region,
    List<String> personas,
    String category,
    // 가이드 §4 축(sub_problem id, 예 value_structure) — 아카이브 컬렉션 자동 분류(레벨2)에 쓴다. 없으면 미분류.
    String axis) {}
