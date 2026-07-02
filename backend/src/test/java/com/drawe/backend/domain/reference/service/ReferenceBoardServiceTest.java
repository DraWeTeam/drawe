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
import com.drawe.backend.domain.llm.search.KomoranKeywordExtractor;
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
  @Mock KomoranKeywordExtractor keywordExtractor;
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
  @DisplayName("검색: 핀·싫어요·기노출 제외, 소스는 섞어서 반환(칩 필터는 클라), 좋아요는 LIKE 표시")
  void search_excludesPinnedDislikedShown_returnsMixedSources() {
    when(user.getId()).thenReturn(USER_ID);
    when(keywordExtractor.extract("cat")).thenReturn(List.of("cat"));
    when(projectRepository.findById(PROJECT_ID)).thenReturn(Optional.of(project));
    when(project.getUser()).thenReturn(user);
    when(project.getPinnedImageIds()).thenReturn(List.of(100L));
    when(searchService.search(any()))
        .thenReturn(
            new SearchResponse(
                List.of(
                    img(100L, "AI"), // pinned → 제외
                    img(200L, "AI"), // liked → 남음(LIKE)
                    img(300L, "UNSPLASH"), // 소스 안 거름 → 섞여서 남음(클라 필터용)
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
        service.search(user, PROJECT_ID, "cat", ReferenceSource.ALL, 12);

    // 핀(100)·싫어요(400)·기노출(500) 제외, AI(200)+사진(300) 섞여서 순서 유지
    assertThat(res.results()).extracting(c -> c.image().id()).containsExactly(200L, 300L);
    assertThat(res.results().get(0).myReaction()).isEqualTo("LIKE"); // 200 좋아요
    assertThat(res.results().get(1).myReaction()).isNull(); // 300 반응 없음
    assertThat(res.blocked()).isFalse();
    verify(sessionService).save(session);
    assertThat(session.getShownImageIds()).contains(200L, 300L);
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

  @Test
  @DisplayName("검색: 관련성 낮으면(점수 가드) 빈 결과 — '검색 결과가 없습니다'")
  void search_lowRelevance_returnsEmpty() {
    when(user.getId()).thenReturn(USER_ID);
    when(keywordExtractor.extract("xyz")).thenReturn(List.of("xyz"));
    when(projectRepository.findById(PROJECT_ID)).thenReturn(Optional.of(project));
    when(project.getUser()).thenReturn(user);
    when(project.getPinnedImageIds()).thenReturn(List.of());
    when(searchService.search(any()))
        .thenReturn(new SearchResponse(List.of(lowScore(1L), lowScore(2L)), 2, "xyz"));

    ReferenceBoardSearchResponse res =
        service.search(user, PROJECT_ID, "xyz", ReferenceSource.ALL, 12);

    assertThat(res.results()).isEmpty();
    assertThat(res.total()).isZero();
    assertThat(res.blocked()).isTrue(); // 관련성 낮음 → 생성 유도 신호
    verifyNoInteractions(sessionService, imageFeedbackRepository);
  }

  /** 점수 가드용 저점수 결과(avg/max 모두 floor 미만). */
  private static ImageResult lowScore(long id) {
    return new ImageResult(
        id,
        "src" + id,
        "u",
        null,
        null,
        0.1f,
        null,
        null,
        null,
        null,
        null,
        null,
        "AI",
        null,
        null);
  }
}
