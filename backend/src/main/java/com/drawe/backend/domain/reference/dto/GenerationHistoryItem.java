package com.drawe.backend.domain.reference.dto;

import java.time.Instant;

/** SCRUM-118: 생성 대화 복원용 1건 — 프롬프트(원문) + 생성 이미지(서명 url). */
public record GenerationHistoryItem(String prompt, Long imageId, String url, Instant createdAt) {}
