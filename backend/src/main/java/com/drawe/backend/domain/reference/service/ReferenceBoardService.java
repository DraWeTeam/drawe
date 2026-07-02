package com.drawe.backend.domain.reference.service;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.ProjectReference;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.FeedbackType;
import com.drawe.backend.domain.feedback.repository.ImageFeedbackRepository;
import com.drawe.backend.domain.feedback.service.ImageFeedbackService;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.domain.reference.dto.ReactionResponse;
import com.drawe.backend.domain.reference.dto.ReferenceBoardSearchResponse;
import com.drawe.backend.domain.reference.dto.ReferenceCard;
import com.drawe.backend.domain.reference.enums.ReferenceSource;
import com.drawe.backend.domain.reference.session.ReferenceBoardSession;
import com.drawe.backend.domain.reference.session.ReferenceBoardSessionService;
import com.drawe.backend.domain.search.dto.ImageResult;
import com.drawe.backend.domain.search.dto.SearchRequest;
import com.drawe.backend.domain.search.dto.SearchResponse;
import com.drawe.backend.domain.search.service.SearchService;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

/**
 * 레퍼런스 보드(SCRUM-113) — 키워드 검색 + 좋아요/싫어요 피드백 루프 오케스트레이션.
 *
 * <p>검색은 기존 {@link SearchService}(CLIP 의미검색)를 <b>그대로 재활용</b>하되, 소스 필터·싫어요 제외·세션 노출이력 제외를 이 레이어에서만
 * 얹는다(검색 도메인 무변경). 좋아요/싫어요 영속은 {@link ImageFeedbackService}(user+image) 재활용. 좋아요는 아카이브 적재가 아니라
 * 정렬·유지용 반응이며, 아카이브 저장은 별도 경로({@code POST /projects/{id}/references})가 담당한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ReferenceBoardService {

  /** 싫어요 몇 회에 생성 유도 모달을 띄울지. */
  private static final int DISLIKE_MODAL_THRESHOLD = 3;

  /** CLIP 검색 후 소스·제외 필터를 적용하므로 넉넉히 뽑는다(SearchService 의 BROAD_K 와 정합). */
  private static final int CANDIDATE_K = 40;

  private static final int DEFAULT_TOP_K = 12;

  private final SearchService searchService;
  private final ImageFeedbackService imageFeedbackService;
  private final ImageFeedbackRepository imageFeedbackRepository;
  private final ProjectReferenceRepository projectReferenceRepository;
  private final ProjectRepository projectRepository;
  private final ReferenceBoardSessionService sessionService;

  /** 키워드 검색. ARCHIVE 는 저장 레퍼런스 텍스트 검색, 그 외는 CLIP 의미검색 + 소스 필터 + (싫어요·기노출) 제외. */
  public ReferenceBoardSearchResponse search(
      User user, Long projectId, String query, ReferenceSource source, Integer topK) {
    int limit = topK != null && topK > 0 ? topK : DEFAULT_TOP_K;
    ReferenceSource src = source != null ? source : ReferenceSource.ALL;

    if (query == null || query.isBlank()) {
      return new ReferenceBoardSearchResponse(List.of(), 0, "", src.name());
    }

    if (src == ReferenceSource.ARCHIVE) {
      return searchArchive(user, query, limit);
    }
    return searchCorpus(user, projectId, query, src, limit);
  }

  private ReferenceBoardSearchResponse searchCorpus(
      User user, Long projectId, String query, ReferenceSource src, int limit) {
    Set<Long> pinned = pinnedImageIds(user, projectId); // 소유 검증 겸함
    SearchResponse raw = searchService.search(new SearchRequest(query, CANDIDATE_K));

    ReferenceBoardSession session = sessionService.get(user.getId(), projectId);
    Set<Long> disliked =
        Set.copyOf(
            imageFeedbackRepository.findImageIdsByUserAndFeedback(user, FeedbackType.DISLIKE));
    Set<Long> liked =
        Set.copyOf(imageFeedbackRepository.findImageIdsByUserAndFeedback(user, FeedbackType.LIKE));
    Set<Long> shown = session.getShownImageIds();
    String sourceFilter = src.imageSourceName(); // AI/UNSPLASH, ALL 이면 null

    List<ImageResult> filtered =
        raw.results().stream()
            .filter(r -> sourceFilter == null || sourceFilter.equals(r.source()))
            .filter(r -> !pinned.contains(r.id())) // 핀은 상단 고정 → 검색 업데이트에서 제외
            .filter(r -> !disliked.contains(r.id())) // 싫어요는 다시 안 보임
            .filter(r -> !shown.contains(r.id())) // 이미 본 건 "새로 노출"에서 제외
            .limit(limit)
            .toList();

    session.markShown(filtered.stream().map(ImageResult::id).toList());
    sessionService.save(session);

    List<ReferenceCard> cards =
        filtered.stream()
            .map(r -> new ReferenceCard(r, liked.contains(r.id()) ? "LIKE" : null))
            .toList();

    log.info(
        "reference-board search — userId={}, projectId={}, source={}, returned={}",
        user.getId(),
        projectId,
        src,
        cards.size());
    return new ReferenceBoardSearchResponse(cards, cards.size(), query, src.name());
  }

  private ReferenceBoardSearchResponse searchArchive(User user, String query, int limit) {
    String kw = "%" + query.toLowerCase() + "%";
    List<ProjectReference> refs =
        projectReferenceRepository.searchByKeyword(user, kw, PageRequest.of(0, limit));
    List<ReferenceCard> cards =
        refs.stream().map(pr -> new ReferenceCard(toImageResult(pr.getImage()), null)).toList();
    return new ReferenceBoardSearchResponse(
        cards, cards.size(), query, ReferenceSource.ARCHIVE.name());
  }

  /** 좋아요 — 반응만 저장(정렬·유지용). 아카이브 적재 아님. */
  public ReactionResponse like(User user, Long projectId, Long imageId) {
    imageFeedbackService.saveFeedback(user, imageId, FeedbackType.LIKE);
    ReferenceBoardSession session = sessionService.get(user.getId(), projectId);
    return new ReactionResponse(imageId, "LIKE", session.getDislikeCount(), false);
  }

  /** 싫어요 — 반응 저장(향후 검색 제외) + 세션 카운터 증가. 3회 도달 시 생성 유도 모달 플래그. */
  public ReactionResponse dislike(User user, Long projectId, Long imageId) {
    imageFeedbackService.saveFeedback(user, imageId, FeedbackType.DISLIKE);
    ReferenceBoardSession session = sessionService.get(user.getId(), projectId);
    int count = session.incrementDislike();
    sessionService.save(session);
    return new ReactionResponse(imageId, "DISLIKE", count, count >= DISLIKE_MODAL_THRESHOLD);
  }

  /** 반응 취소(좋아요/싫어요 해제). */
  public ReactionResponse removeReaction(User user, Long projectId, Long imageId) {
    imageFeedbackService.removeFeedback(user, imageId);
    ReferenceBoardSession session = sessionService.get(user.getId(), projectId);
    return new ReactionResponse(imageId, null, session.getDislikeCount(), false);
  }

  /** 생성 유도 모달 노출 후 싫어요 카운터 리셋(다음 3회부터 다시 트리거). */
  public void ackGenerationSuggestion(User user, Long projectId) {
    ReferenceBoardSession session = sessionService.get(user.getId(), projectId);
    session.resetDislike();
    sessionService.save(session);
  }

  /** 프로젝트 소유 검증 + 핀된 이미지 id 집합. 핀은 상단 고정이라 검색 결과(업데이트분)에서 제외한다. */
  private Set<Long> pinnedImageIds(User user, Long projectId) {
    Project project =
        projectRepository
            .findById(projectId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (!project.getUser().getId().equals(user.getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    List<Long> pins = project.getPinnedImageIds();
    return pins == null ? Set.of() : Set.copyOf(pins);
  }

  /** 아카이브(ProjectReference) 카드용 최소 {@link ImageResult} 매핑 — CLIP score·구조화 태그는 없음(텍스트 검색 경로). */
  private static ImageResult toImageResult(Image img) {
    return new ImageResult(
        img.getId(),
        img.getSourceId(),
        img.getUrl(),
        img.getPhotographerUsername(),
        img.getPhotographerName(),
        null,
        null,
        null,
        null,
        null,
        null,
        img.getRawTags() != null ? img.getRawTags() : Collections.emptyList(),
        img.getSource() != null ? img.getSource().name() : null,
        img.getPrompt(),
        img.getAiDescription());
  }
}
