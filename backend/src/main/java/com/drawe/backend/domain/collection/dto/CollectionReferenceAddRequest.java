package com.drawe.backend.domain.collection.dto;

import jakarta.validation.constraints.NotNull;

/** 레퍼런스를 컬렉션에 저장(SCR-ARCH-05 아카이브) — 기존 이미지 하나를 담는다. (collection,image) 유니크로 멱등. */
public record CollectionReferenceAddRequest(@NotNull Long imageId) {}
