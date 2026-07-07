package com.drawe.backend.domain.reference.controller;

import com.drawe.backend.domain.reference.dto.GenerationHistoryItem;
import com.drawe.backend.domain.reference.dto.ReactionResponse;
import com.drawe.backend.domain.reference.dto.ReferenceBoardSearchResponse;
import com.drawe.backend.domain.reference.enums.ReferenceSource;
import com.drawe.backend.domain.reference.service.ReferenceBoardService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 레퍼런스 보드(SCRUM-113) — 키워드 검색 + 좋아요/싫어요 피드백 루프 API. 기존 검색/피드백/아카이브 코드를 재활용하는 오케스트레이션 레이어(기존 엔드포인트
 * 무변경).
 */
@Slf4j
@RestController
@RequestMapping("/projects/{projectId}/reference-board")
@RequiredArgsConstructor
@Tag(name = "ReferenceBoard", description = "레퍼런스 보드 — 키워드 검색 + 좋아요/싫어요 피드백 루프")
public class ReferenceBoardController {

  private final ReferenceBoardService referenceBoardService;

  @GetMapping("/search")
  @Operation(
      summary = "레퍼런스 키워드 검색",
      description = "키워드 + 소스필터(전체/AI/사진/아카이브)로 검색. 싫어요·기노출 이미지는 제외한다.")
  public ApiResponse<ReferenceBoardSearchResponse> search(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @RequestParam(name = "q", required = false) String query,
      @RequestParam(name = "source", required = false) String source,
      @RequestParam(name = "topK", required = false) Integer topK) {
    ReferenceBoardSearchResponse res =
        referenceBoardService.search(
            principal.getUser(), projectId, query, ReferenceSource.from(source), topK);
    return ApiResponse.success(res);
  }

  @PostMapping("/generate")
  @Operation(
      summary = "레퍼런스 생성",
      description =
          "프롬프트 → bedrock 이미지 생성 → source=AI Image 저장·인덱싱. 반환 {imageId, url}로 즉시 미리보기·담기.")
  public ApiResponse<Map<String, Object>> generate(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @RequestBody Map<String, String> body) {
    return ApiResponse.success(
        referenceBoardService.generateReference(
            principal.getUser(), projectId, body.getOrDefault("prompt", "")));
  }

  @GetMapping("/generations")
  @Operation(
      summary = "생성 대화 이력",
      description = "프로젝트의 레퍼런스 생성 대화(프롬프트→이미지)를 시간순으로 반환. 보드 진입 시 생성 채팅 복원용.")
  public ApiResponse<List<GenerationHistoryItem>> generations(
      @AuthenticationPrincipal PrincipalDetails principal, @PathVariable Long projectId) {
    return ApiResponse.success(
        referenceBoardService.generationHistory(principal.getUser(), projectId));
  }

  @PostMapping("/images/{imageId}/like")
  @Operation(summary = "좋아요", description = "반응 저장(정렬·유지용). 아카이브 적재가 아님.")
  public ApiResponse<ReactionResponse> like(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @PathVariable Long imageId) {
    return ApiResponse.success(referenceBoardService.like(principal.getUser(), projectId, imageId));
  }

  @PostMapping("/images/{imageId}/dislike")
  @Operation(summary = "싫어요", description = "반응 저장 + 향후 검색 제외. 3회 누적 시 생성 유도 모달 플래그를 반환한다.")
  public ApiResponse<ReactionResponse> dislike(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @PathVariable Long imageId) {
    return ApiResponse.success(
        referenceBoardService.dislike(principal.getUser(), projectId, imageId));
  }

  @DeleteMapping("/images/{imageId}/reaction")
  @Operation(summary = "반응 취소", description = "좋아요/싫어요를 해제한다.")
  public ApiResponse<ReactionResponse> removeReaction(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @PathVariable Long imageId) {
    return ApiResponse.success(
        referenceBoardService.removeReaction(principal.getUser(), projectId, imageId));
  }

  @PostMapping("/generation-suggestion/ack")
  @Operation(summary = "생성 유도 모달 확인", description = "모달 노출 후 세션 싫어요 카운터를 리셋한다.")
  public ApiResponse<Map<String, Boolean>> ackGenerationSuggestion(
      @AuthenticationPrincipal PrincipalDetails principal, @PathVariable Long projectId) {
    referenceBoardService.ackGenerationSuggestion(principal.getUser(), projectId);
    return ApiResponse.success(Map.of("success", true));
  }
}
