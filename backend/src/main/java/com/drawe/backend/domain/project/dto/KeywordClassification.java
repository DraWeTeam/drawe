package com.drawe.backend.domain.project.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** 키워드 → 프로젝트 필드 백그라운드 분류 결과. 리스트 밖 단어는 서비스에서 걸러진다(subject 는 첫 키워드로 폴백). */
@JsonIgnoreProperties(ignoreUnknown = true)
public record KeywordClassification(String subject, String mood, String technique) {}
