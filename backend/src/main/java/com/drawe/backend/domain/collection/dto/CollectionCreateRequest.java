package com.drawe.backend.domain.collection.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 새 컬렉션 생성 — SCR-ARCH-05 '아카이브 추가(+)'로 새 컬렉션 만들며 담기, 또는 SCR-ARCH-02 '직접 추가하기'로 (이미지 없이도) 생성.
 * imageIds·tags 는 선택(빈 컬렉션·태그 없이도 허용). 저장 흐름에서 만든 사용자 컬렉션이므로 axis=null·is_system=false.
 */
public record CollectionCreateRequest(
    @NotBlank(message = "컬렉션 이름은 필수입니다")
        @Size(max = 100, message = "컬렉션 이름은 100자 이하여야 합니다")
        String name,
    List<Long> imageIds,
    List<String> tags) {}
