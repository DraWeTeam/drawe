package com.drawe.backend.domain.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 프로젝트 생성 1단계 — 주제 문장 입력("어떤 그림을 그릴 건가요?"). */
public record KeywordExtractionRequest(@NotBlank @Size(max = 500) String topic) {}
