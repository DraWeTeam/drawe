package com.drawe.backend.domain.collection.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 컬렉션 수정(SCR-ARCH-06) — 이름/설명/태그. name 은 필수, description·tags 는 선택(null 이면 미변경 아님 —
 * description=null 은 설명 비움, tags=null 은 태그 비움으로 처리하지 않도록 서비스에서 null 은 "미변경"으로 다룬다).
 */
public record CollectionUpdateRequest(
    @NotBlank(message = "컬렉션 이름은 필수입니다")
        @Size(max = 100, message = "컬렉션 이름은 100자 이하여야 합니다")
        String name,
    @Size(max = 255, message = "설명은 255자 이하여야 합니다") String description,
    List<String> tags) {}
