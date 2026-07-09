package com.drawe.backend.domain.guide.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.drawe.backend.domain.Guide;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.analytics.AnalyticsEventType;
import com.drawe.backend.domain.analytics.service.AnalyticsEventService;
import com.drawe.backend.domain.enums.Axis;
import com.drawe.backend.domain.guide.dto.GuideResult;
import com.drawe.backend.domain.guide.repository.GuideFeedbackRepository;
import com.drawe.backend.domain.guide.repository.GuideRepository;
import com.drawe.backend.domain.image.repository.ImageBlobRepository;
import com.drawe.backend.domain.image.service.DbImageStorage;
import com.drawe.backend.domain.onboarding.UserPrefTagRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.global.client.GuideClient;
import com.drawe.backend.global.client.dto.GuideResponse;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.multipart.MultipartFile;

/** WP8-b 가이딩 계측(GUIDE_RESULT) 발화 규칙 — 신규만·멱등 미발화·예외 안전. */
@ExtendWith(MockitoExtension.class)
class GuideServiceInstrumentationTest {

  @Mock GuideClient guideClient;
  @Mock GuideRepository guideRepository;
  @Mock GuideFeedbackRepository guideFeedbackRepository;
  @Mock ProjectRepository projectRepository;
  @Mock DbImageStorage imageStorage;
  @Mock ImageBlobRepository imageBlobRepository;
  @Mock UserPrefTagRepository userPrefTagRepository;
  @Mock AnalyticsEventService analyticsEventService;

  @InjectMocks GuideService guideService;

  @Mock User user;
  @Mock Project project;
  @Mock MultipartFile file;

  private static GuideResponse coachResp(String focus) {
    return new GuideResponse(
        "coach", "g1", focus, false, null, null, null, "한 끗", null, null, null, null, null, null,
        null, null, null);
  }

  private void stubAuthAndUser() {
    when(user.getId()).thenReturn(1L);
    when(project.getUser()).thenReturn(user);
    when(projectRepository.findById(1L)).thenReturn(Optional.of(project));
  }

  private void stubNewGeneration(GuideResponse resp) throws Exception {
    when(guideRepository.findByRequestId(anyString())).thenReturn(Optional.empty());
    when(file.isEmpty()).thenReturn(false);
    when(file.getBytes()).thenReturn(new byte[] {1, 2, 3});
    when(file.getOriginalFilename()).thenReturn("draw.png");
    when(file.getContentType()).thenReturn(null); // 썸네일 저장 스킵
    when(userPrefTagRepository.findByUserAndAxis(user, Axis.AXIS_MOOD)).thenReturn(List.of());
    when(guideClient.guideImage(
            any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
        .thenReturn(resp);
    lenient().when(guideRepository.save(any(Guide.class))).thenAnswer(inv -> inv.getArgument(0));
  }

  @Test
  void 신규생성_guide_result_발화_mode_담김() throws Exception {
    stubAuthAndUser();
    stubNewGeneration(coachResp("hand_structure"));

    GuideResult result =
        guideService.guide(user, 1L, file, "손이 이상해요", null, null, null, "req-1");

    assertThat(result).isNotNull();
    ArgumentCaptor<Map<String, Object>> cap = ArgumentCaptor.forClass(Map.class);
    verify(analyticsEventService)
        .track(eq(AnalyticsEventType.GUIDE_RESULT), eq(user), isNull(), cap.capture());
    Map<String, Object> payload = cap.getValue();
    assertThat(payload).containsEntry("mode", "coach").containsEntry("degraded", false);
    assertThat(payload).containsEntry("primary_focus", "hand_structure");
  }

  @Test
  void 멱등_재사용_guide_result_미발화() {
    stubAuthAndUser();
    // 같은 request_id 로 이미 저장된 가이드가 있음 → early-return
    Guide existing = new Guide();
    existing.setPayload(coachResp("hand_structure")); // blocks 없음 → referenceUrl 미호출
    existing.setRequestText("손이 이상해요");
    when(guideRepository.findByRequestId("req-1")).thenReturn(Optional.of(existing));

    GuideResult result =
        guideService.guide(user, 1L, file, "손이 이상해요", null, null, null, "req-1");

    assertThat(result).isNotNull();
    // 재사용 경로에선 외부 호출·계측 모두 스킵(중복 카운트 방지)
    verify(guideClient, never())
        .guideImage(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    verify(analyticsEventService, never()).track(anyString(), any(User.class), any(), any());
  }

  @Test
  void 계측_예외나도_가이드_응답_정상() throws Exception {
    stubAuthAndUser();
    stubNewGeneration(coachResp("eye_line"));
    // 계측이 터져도 본 기능은 살아야 함
    doThrow(new RuntimeException("analytics down"))
        .when(analyticsEventService)
        .track(eq(AnalyticsEventType.GUIDE_RESULT), eq(user), isNull(), any());

    GuideResult result =
        guideService.guide(user, 1L, file, null, null, null, null, "req-2");

    assertThat(result).isNotNull();
  }
}
