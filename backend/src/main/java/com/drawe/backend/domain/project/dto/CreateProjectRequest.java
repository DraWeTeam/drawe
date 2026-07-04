package com.drawe.backend.domain.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 프로젝트 생성 2단계(SCRUM-115) — 주제 분석으로 나온 이름 + (사용자 편집한) 키워드로 생성. subject/technique/mood 는 서버가 keywords
 * 에서 백그라운드 분류해 채운다(요청에 없음).
 */
public record CreateProjectRequest(
    @NotBlank @Size(max = 100) String name, List<String> keywords, String description) {}
