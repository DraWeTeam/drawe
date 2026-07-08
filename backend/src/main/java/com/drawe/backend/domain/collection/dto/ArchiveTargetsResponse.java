package com.drawe.backend.domain.collection.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * 카드 ⋮ '아카이브' 서브메뉴용 — 유저의 컬렉션 목록 + 이 이미지가 이미 담겼는지 여부.
 *
 * <p>{@code contained=true} 인 컬렉션은 서브메뉴에서 체크·비활성화로 표시한다.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ArchiveTargetsResponse(List<Target> collections) {

  public record Target(Long id, String name, int count, boolean contained) {}
}
