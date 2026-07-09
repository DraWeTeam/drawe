package com.drawe.backend.domain.project.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.drawe.backend.domain.User;
import com.drawe.backend.domain.analytics.AnalyticsEventType;
import com.drawe.backend.domain.analytics.service.AnalyticsEventService;
import com.drawe.backend.domain.project.dto.KeywordExtractionRequest;
import com.drawe.backend.domain.project.dto.KeywordExtractionResponse;
import com.drawe.backend.domain.project.service.ProjectKeywordService;
import com.drawe.backend.domain.project.service.ProjectService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** keyword-extraction 이 chip_shown 을 계측하는지 + 계측이 본 기능을 깨지 않는지 단위 검증. */
class ProjectControllerChipShownTest {

  private final ProjectService projectService = mock(ProjectService.class);
  private final ProjectKeywordService keywordService = mock(ProjectKeywordService.class);
  private final AnalyticsEventService analytics = mock(AnalyticsEventService.class);
  private final ProjectController controller =
      new ProjectController(projectService, keywordService, analytics);

  @SuppressWarnings("unchecked")
  private static ArgumentCaptor<Map<String, Object>> payloadCaptor() {
    return ArgumentCaptor.forClass(Map.class);
  }

  @Test
  void 노출시_chip_shown_payload_검증() {
    User user = mock(User.class);
    when(keywordService.extract("수채화 인물화"))
        .thenReturn(
            new KeywordExtractionResponse("인물화", List.of("watercolor", "portrait", "soft")));

    ApiResponse<KeywordExtractionResponse> resp =
        controller.keywordExtraction(new PrincipalDetails(user), new KeywordExtractionRequest("수채화 인물화"));

    // 본 기능 응답 정상
    assertThat(resp.getData().keywords()).containsExactly("watercolor", "portrait", "soft");

    ArgumentCaptor<Map<String, Object>> cap = payloadCaptor();
    verify(analytics).track(eq(AnalyticsEventType.CHIP_SHOWN), eq(user), isNull(), cap.capture());
    Map<String, Object> payload = cap.getValue();
    assertThat(payload).containsEntry("source", "ai_keyword").containsEntry("chip_count", 3);
    assertThat(payload).containsEntry("topic_len", "수채화 인물화".length());
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> chips = (List<Map<String, Object>>) payload.get("chips");
    assertThat(chips).hasSize(3);
    assertThat(chips.get(0)).containsEntry("label", "watercolor").containsEntry("position", 0);
    assertThat(chips.get(2)).containsEntry("label", "soft").containsEntry("position", 2);
  }

  @Test
  void 계측_예외나도_추출응답_정상반환() {
    User user = mock(User.class);
    when(keywordService.extract("t")).thenReturn(new KeywordExtractionResponse("n", List.of("a")));
    doThrow(new RuntimeException("boom"))
        .when(analytics)
        .track(anyString(), any(User.class), isNull(), anyMap());

    ApiResponse<KeywordExtractionResponse> resp =
        controller.keywordExtraction(new PrincipalDetails(user), new KeywordExtractionRequest("t"));

    assertThat(resp.getData().keywords()).containsExactly("a");
  }

  @Test
  void keywords_비면_chips_빈배열_chip_count0() {
    when(keywordService.extract("x")).thenReturn(new KeywordExtractionResponse("x", List.of()));

    controller.keywordExtraction(new PrincipalDetails(mock(User.class)), new KeywordExtractionRequest("x"));

    ArgumentCaptor<Map<String, Object>> cap = payloadCaptor();
    verify(analytics).track(eq(AnalyticsEventType.CHIP_SHOWN), any(User.class), isNull(), cap.capture());
    assertThat(cap.getValue()).containsEntry("chip_count", 0);
    assertThat((List<?>) cap.getValue().get("chips")).isEmpty();
  }

  @Test
  void principal_null이어도_null_user로_발화() {
    when(keywordService.extract("x")).thenReturn(new KeywordExtractionResponse("x", List.of("a")));

    controller.keywordExtraction(null, new KeywordExtractionRequest("x"));

    verify(analytics).track(eq(AnalyticsEventType.CHIP_SHOWN), (User) isNull(), isNull(), anyMap());
  }
}
