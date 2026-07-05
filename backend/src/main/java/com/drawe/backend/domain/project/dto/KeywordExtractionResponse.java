package com.drawe.backend.domain.project.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** 주제 분석 결과 — 프로젝트 이름(자동 생성) + 키워드 칩. Grok 응답 파싱 대상이자 API 응답. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record KeywordExtractionResponse(String name, List<String> keywords) {}
