package com.drawe.backend.domain.collection.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * 레퍼런스 상세(SCR-ARCH-05 전체화면) — 원본 이미지 + 이름 + 출처 + 키워드 칩.
 *
 * <p>이름은 스톡/AI 이미지라 고유 명칭이 없어 태그 subject(한글)/캡션/프롬프트에서 유도한다. {@code sourceUrl} 은 출처 표기 텍스트로, 이 이미지가
 * 담긴 프로젝트명(있으면) 또는 DraWe 도메인(폴백)이다. 키워드는 {@code rawTags} — 없으면 빈 배열. 반응(좋아요/별로예요)은 별도 {@code
 * /images/{imageId}/feedback} API 를 재사용한다.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ReferenceDetailResponse(
    Long imageId,
    String url,
    String source,
    String name,
    String sourceUrl,
    List<String> keywords,
    String myReaction) {}
