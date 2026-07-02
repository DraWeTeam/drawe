package com.drawe.backend.domain.reference.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.FeedbackType;
import com.drawe.backend.domain.feedback.repository.ImageFeedbackRepository;
import com.drawe.backend.domain.feedback.service.ImageFeedbackService;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.domain.reference.dto.ReactionResponse;
import com.drawe.backend.domain.reference.dto.ReferenceBoardSearchResponse;
import com.drawe.backend.domain.reference.enums.ReferenceSource;
import com.drawe.backend.domain.reference.session.ReferenceBoardSession;
import com.drawe.backend.domain.reference.session.ReferenceBoardSessionService;
import com.drawe.backend.domain.search.dto.ImageResult;
import com.drawe.backend.domain.search.dto.SearchResponse;
import com.drawe.backend.domain.search.service.SearchService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** SCRUM-113 — 레퍼런스 보드 피드백 루프 핵심 로직 단위 테스트. */
@ExtendWith(MockitoExtension.class)
class ReferenceBoardServiceTest {

  private static final Long USER_ID = 1L;
  private static final Long PROJECT_ID = 10L;

  @Mock SearchService searchService;
  @Mock ImageFeedbackService imageFeedbackService;
  @Mock ImageFeedbackRepository imageFeedbackRepository;
  @Mock ProjectReferenceRepository projectReferenceRepository;
  @Mock ProjectRepository projectRepository;
  @Mock ReferenceBoardSessionService sessionService;

  @InjectMocks ReferenceBoardService service;

  @Mock User user;
  @Mock Project project;

  private static ImageResult img(long id, String source) {
    return new ImageResult(
        id,
        "src" + id,
        "http://url/" + id,
        null,
        null,
        0.9f,
        null,
        null,
        null,
        null,
        null,
        null,
        source,
        null,
        null);
  }

  @Test
  @DisplayName("검색: 핀·싫어요·기노출 제외 + 소스필터(AI), 좋아요는 LIKE 표시")
  void search_excludesPinnedDislikedShown_andFiltersSource() {
    when(user.getId()).thenReturn(USER_ID);
    when(projectRepository.findById(PROJECT_ID)).thenReturn(Optional.of(project));
    when(project.getUser()).thenReturn(user);
    when(project.getPinnedImageIds()).thenReturn(List.of(100L));
    when(searchService.search(any()))
        .thenReturn(
            new SearchResponse(
                List.of(
                    img(100L, "AI"), // pinned → 제외
                    img(200L, "AI"), // liked → 남음(LIKE)
                    img(300L, "UNSPLASH"), // 소스필터(AI)로 제외
                    img(400L, "AI"), // disliked → 제외
                    img(500L, "AI")), // 기노출 → 제외
                5,
                "cat"));
    when(imageFeedbackRepository.findImageIdsByUserAndFeedback(user, FeedbackType.DISLIKE))
        .thenReturn(List.of(400L));
    when(imageFeedbackRepository.findImageIdsByUserAndFeedback(user, FeedbackType.LIKE))
        .thenReturn(List.of(200L));
    ReferenceBoardSession session = ReferenceBoardSession.start(USER_ID, PROJECT_ID);
    session.markShown(List.of(500L));
    when(sessionService.get(USER_ID, PROJECT_ID)).thenReturn(session);

    ReferenceBoardSearchResponse res =
        service.search(user, PROJECT_ID, "cat", ReferenceSource.AI, 12);

    assertThat(res.results()).hasSize(1);
    assertThat(res.results().get(0).image().id()).isEqualTo(200L);
    assertThat(res.results().get(0).myReaction()).isEqualTo("LIKE");
    verify(sessionService).save(session);
    assertThat(session.getShownImageIds()).contains(200L);
  }

  @Test
  @DisplayName("싫어요 3회 → suggestGeneration=true")
  void dislike_thirdTime_suggestsGeneration() {
    when(user.getId()).thenReturn(USER_ID);
    ReferenceBoardSession session = ReferenceBoardSession.start(USER_ID, PROJECT_ID);
    session.setDislikeCount(2);
    when(sessionService.get(USER_ID, PROJECT_ID)).thenReturn(session);

    ReactionResponse res = service.dislike(user, PROJECT_ID, 999L);

    assertThat(res.reaction()).isEqualTo("DISLIKE");
    assertThat(res.dislikeCount()).isEqualTo(3);
    assertThat(res.suggestGeneration()).isTrue();
    verify(imageFeedbackService).saveFeedback(user, 999L, FeedbackType.DISLIKE);
    verify(sessionService).save(session);
  }

  @Test
  @DisplayName("싫어요 1회 → suggestGeneration=false")
  void dislike_firstTime_noSuggest() {
    when(user.getId()).thenReturn(USER_ID);
    ReferenceBoardSession session = ReferenceBoardSession.start(USER_ID, PROJECT_ID);
    when(sessionService.get(USER_ID, PROJECT_ID)).thenReturn(session);

    ReactionResponse res = service.dislike(user, PROJECT_ID, 999L);

    assertThat(res.dislikeCount()).isEqualTo(1);
    assertThat(res.suggestGeneration()).isFalse();
  }

  @Test
  @DisplayName("좋아요는 반응만 저장 — 아카이브(ProjectReference) 적재 안 함")
  void like_doesNotArchive() {
    when(user.getId()).thenReturn(USER_ID);
    when(sessionService.get(USER_ID, PROJECT_ID))
        .thenReturn(ReferenceBoardSession.start(USER_ID, PROJECT_ID));

    ReactionResponse res = service.like(user, PROJECT_ID, 777L);

    assertThat(res.reaction()).isEqualTo("LIKE");
    assertThat(res.suggestGeneration()).isFalse();
    verify(imageFeedbackService).saveFeedback(user, 777L, FeedbackType.LIKE);
    verifyNoInteractions(projectReferenceRepository);
  }

  @Test
  @DisplayName("빈 검색어는 검색하지 않고 빈 결과")
  void blankQuery_returnsEmpty() {
    ReferenceBoardSearchResponse res =
        service.search(user, PROJECT_ID, "   ", ReferenceSource.ALL, null);

    assertThat(res.results()).isEmpty();
    assertThat(res.total()).isZero();
    verify(searchService, never()).search(any());
    verifyNoInteractions(projectRepository);
  }
}
