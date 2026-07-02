package com.drawe.backend.domain.reference.service;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.ProjectReference;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.FeedbackType;
import com.drawe.backend.domain.feedback.repository.ImageFeedbackRepository;
import com.drawe.backend.domain.feedback.service.ImageFeedbackService;
import com.drawe.backend.domain.llm.search.KomoranKeywordExtractor;
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

  private static final int DEFAULT_TOP_K = 10;

  /** topK 상한 — 프론트가 과도한 값을 보내도 이 이상은 반환하지 않는다(코퍼스 overfetch 폭과 동일). */
  private static final int MAX_TOP_K = CANDIDATE_K;

  /** 관련성 가드 — 챗 {@code SearchExecutor} 와 동일. avg<0.2 AND max<0.24 이면 무관 결과로 보고 빈 결과 반환. */
  private static final double AVG_SCORE_FLOOR = 0.2;

  private static final double MAX_SCORE_FLOOR = 0.24;

  private final SearchService searchService;
  private final KomoranKeywordExtractor keywordExtractor;
  private final ImageFeedbackService imageFeedbackService;
  private final ImageFeedbackRepository imageFeedbackRepository;
  private final ProjectReferenceRepository projectReferenceRepository;
  private final ProjectRepository projectRepository;
  private final ReferenceBoardSessionService sessionService;

  /** 키워드 검색. ARCHIVE 는 저장 레퍼런스 텍스트 검색, 그 외는 CLIP 의미검색 + 소스 필터 + (싫어요·기노출) 제외. */
  public ReferenceBoardSearchResponse search(
      User user, Long projectId, String query, ReferenceSource source, Integer topK) {
    int limit = topK != null && topK > 0 ? Math.min(topK, MAX_TOP_K) : DEFAULT_TOP_K;
    ReferenceSource src = source != null ? source : ReferenceSource.ALL;

    if (query == null || query.isBlank()) {
      return new ReferenceBoardSearchResponse(List.of(), 0, "", src.name(), false);
    }

    if (src == ReferenceSource.ARCHIVE) {
      return searchArchive(user, query, limit);
    }
    return searchCorpus(user, projectId, query, src, limit);
  }

  private ReferenceBoardSearchResponse searchCorpus(
      User user, Long projectId, String query, ReferenceSource src, int limit) {
    Set<Long> pinned = pinnedImageIds(user, projectId); // 소유 검증 겸함

    // CLIP(영어 중심)에 한글을 그대로 태우면 검색이 안 된다. 챗 파이프라인과 동일하게
    // Komoran + 미술사전(KO→EN, 미스율 높으면 Grok 폴백)으로 영문 키워드를 뽑아 임베딩한다.
    List<String> keywords = keywordExtractor.extract(query);
    String searchQuery = keywords.isEmpty() ? query : String.join(" ", keywords);
    SearchResponse raw = searchService.search(new SearchRequest(searchQuery, CANDIDATE_K));

    // 관련성 가드 — 최상위도 별로고(max<0.24) 평균도 낮으면(avg<0.2) 무관 결과로 보고 "검색 결과 없음".
    if (isLowRelevance(raw.results())) {
      log.info(
          "reference-board search — 관련성 낮음(빈 결과): userId={}, projectId={}, source={}",
          user.getId(),
          projectId,
          src);
      return new ReferenceBoardSearchResponse(List.of(), 0, query, src.name(), true);
    }

    ReferenceBoardSession session = sessionService.get(user.getId(), projectId);
    Set<Long> disliked =
        Set.copyOf(
            imageFeedbackRepository.findImageIdsByUserAndFeedback(user, FeedbackType.DISLIKE));
    Set<Long> liked =
        Set.copyOf(imageFeedbackRepository.findImageIdsByUserAndFeedback(user, FeedbackType.LIKE));
    Set<Long> shown = session.getShownImageIds();

    // 소스(AI/사진)는 서버에서 안 거른다 — 칩 필터는 클라이언트가 결과셋의 source 로 처리(칩 클릭 시 재검색 X).
    // 서버는 핀·싫어요·기노출만 제외하고 AI+사진을 섞어서 반환한다.
    List<ImageResult> filtered =
        raw.results().stream()
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
    return new ReferenceBoardSearchResponse(cards, cards.size(), query, src.name(), false);
  }

  private ReferenceBoardSearchResponse searchArchive(User user, String query, int limit) {
    String kw = "%" + query.toLowerCase() + "%";
    List<ProjectReference> refs =
        projectReferenceRepository.searchByKeyword(user, kw, PageRequest.of(0, limit));
    List<ReferenceCard> cards =
        refs.stream().map(pr -> new ReferenceCard(toImageResult(pr.getImage()), null)).toList();
    return new ReferenceBoardSearchResponse(
        cards, cards.size(), query, ReferenceSource.ARCHIVE.name(), false);
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

  /** 관련성 가드 판정 — 결과가 없거나 (avg<floor AND max<floor) 이면 무관 결과로 본다. */
  private static boolean isLowRelevance(List<ImageResult> results) {
    if (results.isEmpty()) {
      return true;
    }
    double avg =
        results.stream()
            .mapToDouble(r -> r.score() != null ? r.score() : 0.0)
            .average()
            .orElse(0.0);
    double max =
        results.stream().mapToDouble(r -> r.score() != null ? r.score() : 0.0).max().orElse(0.0);
    return avg < AVG_SCORE_FLOOR && max < MAX_SCORE_FLOOR;
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
