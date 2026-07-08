package com.drawe.backend.domain.collection.dto;

import java.util.List;

/**
 * 정보 수정(SCR-ARCH-05 카드 ⋮) — 레퍼런스 정보 수정.
 *
 * <p>{@code targetCollectionId} 가 있으면 다른 컬렉션으로 이동(아카이브 위치 변경). {@code userTags} 가 있으면(null 아님) 이
 * 레퍼런스의 사용자 태그를 통째로 교체한다. 둘 다 선택이라, 태그만 수정하거나 이동만 할 수 있다.
 */
public record CollectionReferenceMoveRequest(
    Long targetCollectionId, List<String> userTags) {}
