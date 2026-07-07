package com.drawe.backend.domain.collection.dto;

import jakarta.validation.constraints.NotNull;

/** 정보 수정(SCR-ARCH-05 카드 ⋮) — 레퍼런스를 다른 컬렉션으로 이동(아카이브 위치 변경). */
public record CollectionReferenceMoveRequest(@NotNull Long targetCollectionId) {}
