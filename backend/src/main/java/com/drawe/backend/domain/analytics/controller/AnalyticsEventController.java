package com.drawe.backend.domain.analytics.controller;

import com.drawe.backend.domain.User;
import com.drawe.backend.domain.analytics.AnalyticsEventType;
import com.drawe.backend.domain.analytics.dto.AnalyticsEventIngestRequest;
import com.drawe.backend.domain.analytics.service.AnalyticsEventService;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import jakarta.validation.Valid;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 프론트 → 백엔드 범용 analytics 이벤트 적재.
 *
 * <p>서버가 자체 발생시키는 이벤트(예: chat_success, feedback_submitted)와 달리, 프론트에서만 관측 가능한 UI 이벤트(피드백 카드 노출/오픈)를
 * 받는 창구. 임의 이벤트 적재를 막기 위해 {@link #ALLOWED} 화이트리스트만 허용하고, 그 외 타입은 400.
 */
@RestController
@RequestMapping("/analytics/events")
@RequiredArgsConstructor
public class AnalyticsEventController {

  /** 적재 허용 이벤트 타입 — 피드백 깔때기 3종만. */
  private static final Set<String> ALLOWED =
      Set.of(
          AnalyticsEventType.FEEDBACK_MODAL_TRIGGERED,
          AnalyticsEventType.FEEDBACK_MODAL_OPENED,
          AnalyticsEventType.FEEDBACK_SUBMITTED);

  private final AnalyticsEventService analyticsEventService;

  @PostMapping
  public ResponseEntity<ApiResponse<Void>> ingest(
      @AuthenticationPrincipal PrincipalDetails principal,
      @Valid @RequestBody AnalyticsEventIngestRequest request) {

    if (!ALLOWED.contains(request.eventType())) {
      throw new CustomException(ErrorCode.INVALID_INPUT);
    }

    User user = principal.getUser();
    Map<String, Object> payload = new HashMap<>();
    payload.put("turn_count", request.turnCount());

    analyticsEventService.track(request.eventType(), user, request.sessionId(), payload);
    return ResponseEntity.ok(ApiResponse.success());
  }
}
