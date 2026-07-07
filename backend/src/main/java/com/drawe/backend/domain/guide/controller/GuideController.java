package com.drawe.backend.domain.guide.controller;

import com.drawe.backend.domain.guide.dto.GuideFeedbackRequest;
import com.drawe.backend.domain.guide.dto.GuideResult;
import com.drawe.backend.domain.guide.dto.ReferenceFeedbackRequest;
import com.drawe.backend.domain.guide.dto.RerollRequest;
import com.drawe.backend.domain.guide.dto.RerollResult;
import com.drawe.backend.domain.guide.service.GuideService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이미지 가이딩(한 끗 가이드) 전용 엔드포인트. 클립📎 업로드 모달이 호출.
 *
 * <p>멀티파트: file(필수) + message/intent/track/medium(선택). 멱등은 Idempotency-Key 헤더로.
 */
@RestController
@RequestMapping("/projects/{projectId}/guide")
@RequiredArgsConstructor
public class GuideController {

  private final GuideService guideService;

  /** 채팅 재진입 시 가이드 카드 복원용 — 프로젝트의 가이드 히스토리(오래된→최신). */
  @GetMapping
  public ApiResponse<List<GuideResult>> list(
      @AuthenticationPrincipal PrincipalDetails principal, @PathVariable Long projectId) {
    return ApiResponse.success(guideService.list(principal.getUser(), projectId));
  }

  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ApiResponse<GuideResult> guide(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @RequestPart("file") MultipartFile file,
      @RequestParam(value = "message", required = false) String message,
      @RequestParam(value = "intent", required = false) String intent,
      @RequestParam(value = "track", required = false) String track,
      @RequestParam(value = "medium", required = false) String medium,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ApiResponse.success(
        guideService.guide(
            principal.getUser(), projectId, file, message, intent, track, medium, idempotencyKey));
  }

  /**
   * 가이드 내 레퍼런스 묶음 피드백(👍/👎). 그 가이드가 보여준 레퍼런스(최대 3컷)에 liked/disliked 를 기록한다. body: {@code {"event":
   * "liked" | "disliked"}}.
   */
  @PostMapping("/{guideId}/references/feedback")
  public ApiResponse<Void> referenceFeedback(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @PathVariable String guideId,
      @RequestBody ReferenceFeedbackRequest request) {
    guideService.adoptReferences(
        principal.getUser(), projectId, guideId, request.event(), request.referenceIds());
    return ApiResponse.success();
  }

  /**
   * 레퍼런스 재추천("다시 추천" 🔄). 저장된 가이드의 축(subProblem)으로 새 레퍼런스 컷을 받는다(LLM 미경유). body: {@code
   * {"subProblem": "...", "exclude": ["ref_id", ...]}} — exclude = 화면에 이미 노출된 ref 전부. 응답: 새
   * 컷(references) 또는 고갈(exhausted) 또는 생성 중(pendingMessage).
   */
  @PostMapping("/{guideId}/references/reroll")
  public ApiResponse<RerollResult> rerollReference(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @PathVariable String guideId,
      @RequestBody RerollRequest request) {
    return ApiResponse.success(
        guideService.rerollReferences(
            principal.getUser(), projectId, guideId, request.subProblem(), request.exclude()));
  }

  /**
   * 가이드 전체 피드백(👍/👎). adoption_log 와 분리된 guide_feedback 에 사용자별 1행으로 수집한다. body: {@code
   * {"feedback": "like" | "dislike" | null}}. null/빈 값은 토글 해제(삭제).
   */
  @PostMapping("/{guideId}/feedback")
  public ApiResponse<Void> guideFeedback(
      @AuthenticationPrincipal PrincipalDetails principal,
      @PathVariable Long projectId,
      @PathVariable String guideId,
      @RequestBody GuideFeedbackRequest request) {
    guideService.setGuideFeedback(principal.getUser(), projectId, guideId, request.feedback());
    return ApiResponse.success();
  }
}
