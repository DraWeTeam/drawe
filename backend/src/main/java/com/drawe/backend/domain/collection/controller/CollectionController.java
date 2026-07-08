package com.drawe.backend.domain.collection.controller;

import com.drawe.backend.domain.collection.dto.ArchiveTargetsResponse;
import com.drawe.backend.domain.collection.dto.CollectionCreateRequest;
import com.drawe.backend.domain.collection.dto.CollectionDetailResponse;
import com.drawe.backend.domain.collection.dto.CollectionReferenceAddRequest;
import com.drawe.backend.domain.collection.dto.CollectionReferenceMoveRequest;
import com.drawe.backend.domain.collection.dto.CollectionSummaryResponse;
import com.drawe.backend.domain.collection.dto.CollectionUpdateRequest;
import com.drawe.backend.domain.collection.dto.ReferenceDetailResponse;
import com.drawe.backend.domain.collection.service.CollectionService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
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

  /** 레퍼런스 상세(SCR-ARCH-05 전체화면) — 원본/이름/출처/키워드/내 반응. 이미지 단위(컬렉션 무관). */
  @GetMapping("/reference/{imageId}")
  @Operation(
      summary = "레퍼런스 상세",
      description = "레퍼런스 한 장의 원본 이미지·이름·출처 링크·키워드·내 반응을 반환합니다(SCR-ARCH-05).")
  public ApiResponse<ReferenceDetailResponse> referenceDetail(
      @AuthenticationPrincipal PrincipalDetails principal, @PathVariable Long imageId) {
    return ApiResponse.success(
        collectionService.getReferenceDetail(principal.getUser(), imageId));
  }

  /** 카드 ⋮ '아카이브' 서브메뉴 — 내 컬렉션 목록 + 이 이미지가 이미 담겼는지 여부. */
  @GetMapping("/reference/{imageId}/targets")
  @Operation(
      summary = "아카이브 대상 컬렉션 목록",
      description = "이미지를 저장할 수 있는 내 컬렉션 목록과 이미 담긴 여부(체크 표시용)를 반환합니다.")
  public ApiResponse<ArchiveTargetsResponse> archiveTargets(
      @AuthenticationPrincipal PrincipalDetails principal, @PathVariable Long imageId) {
    return ApiResponse.success(
        collectionService.getArchiveTargets(principal.getUser(), imageId));
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

  /** 새 컬렉션 생성 — '아카이브 추가(+)' 또는 '직접 추가하기'. imageIds 로 담아 생성 가능. */
  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(summary = "컬렉션 생성", description = "새 컬렉션을 만듭니다. imageIds 를 주면 함께 담습니다.")
  public ApiResponse<Map<String, Long>> create(
      @AuthenticationPrincipal PrincipalDetails principal,
      @Valid @RequestBody CollectionCreateRequest request) {
    Long id = collectionService.createCollection(principal.getUser(), request);
    return ApiResponse.success(Map.of("collectionId", id));
  }

  /** 레퍼런스 저장(SCR-ARCH-05 아카이브) — 이미지를 컬렉션에 담습니다(멱등). */
  @PostMapping("/{collectionId}/references")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(summary = "레퍼런스 컬렉션 저장", description = "이미지를 컬렉션에 담습니다. 중복은 멱등 처리됩니다.")
  public ApiResponse<Map<String, Boolean>> addReference(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long collectionId,
      @Valid @RequestBody CollectionReferenceAddRequest request) {
    collectionService.addReference(principal.getUser(), collectionId, request.imageId());
    return ApiResponse.success(Map.of("success", true));
  }

  /** 아카이브 취소(SCR-ARCH-05 카드 ⋮) — 컬렉션에서 레퍼런스 제거. */
  @DeleteMapping("/{collectionId}/references/{imageId}")
  @Operation(summary = "레퍼런스 아카이브 취소", description = "컬렉션에서 레퍼런스를 제거합니다.")
  public ApiResponse<Map<String, Boolean>> removeReference(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long collectionId,
      @PathVariable Long imageId) {
    collectionService.removeReference(principal.getUser(), collectionId, imageId);
    return ApiResponse.success(Map.of("success", true));
  }

  /** 정보 수정(SCR-ARCH-05 카드 ⋮) — 레퍼런스의 사용자 태그 수정 및 다른 컬렉션으로 이동(둘 다 선택). */
  @PatchMapping("/{collectionId}/references/{imageId}/move")
  @Operation(
      summary = "레퍼런스 정보 수정",
      description =
          "레퍼런스의 사용자 태그를 수정하고(선택) 다른 컬렉션으로 옮깁니다(선택). 대상에 이미 있으면 원본에서만 제거합니다(멱등).")
  public ApiResponse<Map<String, Boolean>> moveReference(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long collectionId,
      @PathVariable Long imageId,
      @Valid @RequestBody CollectionReferenceMoveRequest request) {
    collectionService.moveReference(
        principal.getUser(),
        collectionId,
        imageId,
        request.targetCollectionId(),
        request.userTags());
    return ApiResponse.success(Map.of("success", true));
  }

  /** 고정하기 토글(SCR-ARCH-05 카드 ⋮). */
  @PostMapping("/{collectionId}/references/{imageId}/pin")
  @Operation(summary = "레퍼런스 고정 토글", description = "컬렉션 내 레퍼런스의 고정 여부를 토글합니다.")
  public ApiResponse<Map<String, Boolean>> togglePin(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long collectionId,
      @PathVariable Long imageId) {
    collectionService.togglePin(principal.getUser(), collectionId, imageId);
    return ApiResponse.success(Map.of("success", true));
  }
}
