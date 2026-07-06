package com.drawe.backend.domain.collection.controller;

import com.drawe.backend.domain.collection.dto.CollectionDetailResponse;
import com.drawe.backend.domain.collection.dto.CollectionSummaryResponse;
import com.drawe.backend.domain.collection.dto.CollectionUpdateRequest;
import com.drawe.backend.domain.collection.service.CollectionService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/collections")
@RequiredArgsConstructor
@Tag(name = "Collection", description = "아카이브 레퍼런스 컬렉션 API (SCR-ARCH-01~06)")
public class CollectionController {

  private final CollectionService collectionService;

  /** 아카이브 목록(SCR-ARCH-02) — 내 컬렉션 카드 목록(4분할 썸네일 + 이름 + 태그칩). */
  @GetMapping
  @Operation(summary = "컬렉션 목록", description = "로그인 유저의 레퍼런스 컬렉션을 카드(썸네일/이름/태그)로 최신순 반환합니다.")
  public ApiResponse<CollectionSummaryResponse> list(
      @AuthenticationPrincipal PrincipalDetails principal) {
    return ApiResponse.success(collectionService.getCollections(principal.getUser()));
  }

  /** 컬렉션 상세(SCR-ARCH-04) — 헤더 + 레퍼런스 그리드(고정 우선, 최신순). */
  @GetMapping("/{collectionId}")
  @Operation(summary = "컬렉션 상세", description = "컬렉션 하나의 정보와 담긴 레퍼런스 목록을 반환합니다.")
  public ApiResponse<CollectionDetailResponse> detail(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long collectionId) {
    return ApiResponse.success(
        collectionService.getCollection(principal.getUser(), collectionId));
  }

  /** 컬렉션 수정(SCR-ARCH-06) — 이름/설명/태그. */
  @PatchMapping("/{collectionId}")
  @Operation(summary = "컬렉션 수정", description = "컬렉션의 이름·설명·태그를 수정합니다.")
  public ApiResponse<Map<String, Boolean>> update(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long collectionId,
      @Valid @RequestBody CollectionUpdateRequest request) {
    collectionService.updateCollection(principal.getUser(), collectionId, request);
    return ApiResponse.success(Map.of("success", true));
  }

  /** 컬렉션 삭제(SCR-ARCH-06) — 담긴 레퍼런스도 함께 삭제. */
  @DeleteMapping("/{collectionId}")
  @Operation(summary = "컬렉션 삭제", description = "컬렉션과 담긴 모든 레퍼런스를 삭제합니다.")
  public ApiResponse<Map<String, Boolean>> delete(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long collectionId) {
    collectionService.deleteCollection(principal.getUser(), collectionId);
    return ApiResponse.success(Map.of("success", true));
  }
}
