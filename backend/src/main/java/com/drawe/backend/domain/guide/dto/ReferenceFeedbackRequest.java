package com.drawe.backend.domain.guide.dto;

import java.util.List;

/** 가이드 내 레퍼런스 묶음 피드백 요청. {@code event} ∈ {"liked", "disliked"}. */
public record ReferenceFeedbackRequest(String event, List<String> referenceIds) {}
