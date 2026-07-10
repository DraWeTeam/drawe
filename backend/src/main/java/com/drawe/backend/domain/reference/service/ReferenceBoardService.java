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
import com.drawe.backend.domain.reference.ReferenceGeneration;
import com.drawe.backend.domain.reference.dto.GenerationHistoryItem;
import com.drawe.backend.domain.reference.dto.ReactionResponse;
import com.drawe.backend.domain.reference.dto.ReferenceBoardSearchResponse;
import com.drawe.backend.domain.reference.dto.ReferenceCard;
import com.drawe.backend.domain.reference.enums.ReferenceSource;
import com.drawe.backend.domain.reference.repository.ReferenceGenerationRepository;
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
import org.springframework.transaction.annotation.Transactional;

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

  /** score backstop — 태그가 잡혀도 최상위 CLIP 유사도가 이보다 낮으면 무관으로 본다. 카페 max≈0.204 는 통과하되 그 바로 아래로 잡음. */
  private static final double MIN_MAX_SCORE = 0.18;

  private final SearchService searchService;
  private final KomoranKeywordExtractor keywordExtractor;
  private final ImageFeedbackService imageFeedbackService;
  private final ImageFeedbackRepository imageFeedbackRepository;
  private final ProjectReferenceRepository projectReferenceRepository;
  private final ProjectRepository projectRepository;
  private final ReferenceBoardSessionService sessionService;
  private final ReferenceGenerationRepository referenceGenerationRepository;
  private final ReferenceBoardImpressionService impressionService;
  private final com.drawe.backend.domain.analytics.service.AnalyticsEventService
      analyticsEventService;
  private final com.drawe.backend.domain.image.service.ImageGenerationService
      imageGenerationService;
  private final com.drawe.backend.domain.image.service.ImageUrlSigner imageUrlSigner;

  /**
   * 브라우저 노출용 이미지 URL 서명 — s3:{key}→presigned, /images/{id}→HMAC, 절대(Unsplash 시드)·null 은 원본. prod(s3
   * 프로파일)에서 Image.url 은 "s3:{key}" 라 서명 없이는 &lt;img&gt;/AuthedImage 가 로드하지 못한다.
   */
  private String signed(String url) {
    return (url != null && imageUrlSigner != null) ? imageUrlSigner.sign(url) : url;
  }

  private ImageResult signImg(ImageResult r) {
    return r == null ? null : r.withUrl(signed(r.url()));
  }

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

    // 관련성 게이트(주) — 상위 결과의 태그/설명에 키워드가 하나도 안 잡히면 코퍼스에 없는 주제로 보고 "검색 결과 없음"(→ 생성 유도).
    // CLIP 점수는 쿼리마다 절대값이 달라(햄버거 0.239 > 카페 0.204) 주 판정엔 못 쓰고, max 가 아주 낮은 경우만 거르는 느슨한 backstop.
    List<ImageResult> window =
        raw.results().size() > DEFAULT_TOP_K
            ? raw.results().subList(0, DEFAULT_TOP_K)
            : raw.results();
    double avg =
        window.stream().mapToDouble(r -> r.score() != null ? r.score() : 0.0).average().orElse(0.0);
    double max =
        window.stream().mapToDouble(r -> r.score() != null ? r.score() : 0.0).max().orElse(0.0);
    boolean tagRelevant = hasKeywordInTags(window, keywords.isEmpty() ? List.of(query) : keywords);
    boolean blocked = raw.results().isEmpty() || !tagRelevant || max < MIN_MAX_SCORE;
    log.info(
        "reference-board search — q='{}' → kw='{}', raw={}, avg={}, max={}, tagRelevant={}, blocked={}",
        query,
        searchQuery,
        raw.results().size(),
        String.format("%.3f", avg),
        String.format("%.3f", max),
        tagRelevant,
        blocked);
    if (blocked) {
      // 보드 검색 수요·실패 로깅 — 결과 약해 생성으로 이어지는 검색어를 어드민 검색 품질에서 볼 수 있게(fail-safe).
      emitBoardSearch(user, query, true, 0, avg, max);
      return new ReferenceBoardSearchResponse(List.of(), 0, query, src.name(), true);
    }

    Set<Long> disliked =
        Set.copyOf(
            imageFeedbackRepository.findImageIdsByUserAndFeedback(user, FeedbackType.DISLIKE));
    Set<Long> liked =
        Set.copyOf(imageFeedbackRepository.findImageIdsByUserAndFeedback(user, FeedbackType.LIKE));

    // 소스(AI/사진)·아카이브 필터는 클라이언트 담당. 서버는 랭킹순 상위 limit 개만 반환(핀·싫어요 제외).
    // 페이징은 프론트 클라 페이징("더보기")이 처리 → shown 세션 dedup 불필요(검색=항상 상위, deterministic).
    List<ReferenceCard> cards =
        raw.results().stream()
            .filter(r -> !pinned.contains(r.id())) // 핀은 상단 고정 → 검색 결과에서 제외
            .filter(r -> !disliked.contains(r.id())) // 싫어요는 다시 안 보임
            .limit(limit)
            .map(r -> new ReferenceCard(signImg(r), liked.contains(r.id()) ? "LIKE" : null))
            .toList();

    log.info(
        "reference-board search — userId={}, projectId={}, source={}, returned={}",
        user.getId(),
        projectId,
        src,
        cards.size());

    // 능동 수집 퍼널 anchor — 실제 노출된 결과 카드의 image_id 를 fail-safe 로 적재(검색 응답엔 영향 0).
    impressionService.record(
        user.getId(),
        query,
        src.name(),
        cards.stream().map(c -> c.image().id()).filter(java.util.Objects::nonNull).toList());

    // 보드 검색 수요 로깅 — 검색 품질(보드) 섹션 집계용(fail-safe).
    emitBoardSearch(user, query, false, cards.size(), avg, max);

    // SCRUM-113: 마지막 검색어 저장(결과 있을 때만) — 재진입 시 서버 기반으로 자동 복원(로그아웃/디바이스 무관).
    //   검색 도중 다른 변경(핀 등) 클로버 방지로 재조회 후 lastReferenceQuery 만 갱신.
    if (!cards.isEmpty()) {
      projectRepository
          .findById(projectId)
          .filter(p -> !query.equals(p.getLastReferenceQuery()))
          .ifPresent(
              p -> {
                p.setLastReferenceQuery(query);
                projectRepository.save(p);
              });
    }
    return new ReferenceBoardSearchResponse(cards, cards.size(), query, src.name(), false);
  }

  /**
   * 보드 검색 수요·실패 이벤트 기록(fail-safe). 채팅 검색(search_executed/blocked)과 별개 event_type 으로 남겨 어드민 검색 품질의
   * 보드 섹션에서만 집계된다. keyword 는 원문 쿼리(민감 키라 로그에선 길이로 마스킹, DB엔 원문 저장).
   */
  private void emitBoardSearch(
      User user, String query, boolean blocked, int resultCount, double avg, double max) {
    java.util.Map<String, Object> payload = new java.util.HashMap<>();
    payload.put("keyword", query);
    payload.put("result_count", resultCount);
    payload.put("avg_score", avg);
    payload.put("max_score", max);
    analyticsEventService.track(
        blocked
            ? com.drawe.backend.domain.analytics.AnalyticsEventType.BOARD_SEARCH_BLOCKED
            : com.drawe.backend.domain.analytics.AnalyticsEventType.BOARD_SEARCH_EXECUTED,
        user,
        null,
        payload);
  }

  private ReferenceBoardSearchResponse searchArchive(User user, String query, int limit) {
    String kw = "%" + query.toLowerCase() + "%";
    List<ProjectReference> refs =
        projectReferenceRepository.searchByKeyword(user, kw, PageRequest.of(0, limit));
    List<ReferenceCard> cards =
        refs.stream()
            .map(pr -> new ReferenceCard(signImg(toImageResult(pr.getImage())), null))
            .toList();
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

  /** 상위 결과의 태그/설명에 키워드(영문)가 하나라도 substring 으로 잡히면 관련 있다고 본다(코퍼스에 그 주제가 있음). */
  private static boolean hasKeywordInTags(List<ImageResult> results, List<String> keywords) {
    List<String> kws =
        keywords.stream().filter(k -> k != null && !k.isBlank()).map(k -> k.toLowerCase()).toList();
    if (kws.isEmpty()) {
      return false;
    }
    for (ImageResult r : results) {
      String text = tagText(r);
      for (String kw : kws) {
        if (text.contains(kw)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 이미지의 태그·설명(subject/technique/mood/utility/freeTags/rawTags/prompt/aiDescription)을 소문자 한 덩어리로.
   */
  private static String tagText(ImageResult r) {
    StringBuilder sb = new StringBuilder();
    appendIf(sb, r.subject());
    appendIf(sb, r.technique());
    appendIf(sb, r.mood());
    appendIf(sb, r.prompt());
    appendIf(sb, r.aiDescription());
    appendAll(sb, r.utility());
    appendAll(sb, r.freeTags());
    appendAll(sb, r.rawTags());
    return sb.toString().toLowerCase();
  }

  private static void appendIf(StringBuilder sb, String s) {
    if (s != null) {
      sb.append(' ').append(s);
    }
  }

  private static void appendAll(StringBuilder sb, List<String> items) {
    if (items != null) {
      items.forEach(s -> appendIf(sb, s));
    }
  }

  /**
   * 레퍼런스 생성 — 프롬프트를 bedrock(활성 provider)으로 이미지화하고, source=AI Image 로 저장·인덱싱한다. 반환 {imageId, url} 로
   * 프론트가 즉시 미리보기·담기(addReference)한다.
   */
  @Transactional
  public java.util.Map<String, Object> generateReference(User user, Long projectId, String prompt) {
    Project project =
        projectRepository
            .findById(projectId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (!project.getUser().getId().equals(user.getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    Image image = imageGenerationService.generate(user, prompt, project);

    // SCRUM-118: 생성 대화 저장 — [프롬프트 원문 + 생성 이미지]를 이력으로 남겨 진입 시 채팅 복원(가이드 채팅처럼).
    ReferenceGeneration gen = new ReferenceGeneration();
    gen.setProjectId(projectId);
    gen.setUserId(user.getId());
    gen.setPrompt(prompt.length() > 500 ? prompt.substring(0, 500) : prompt);
    gen.setImageId(image.getId());
    gen.setUrl(image.getUrl()); // 원본(미서명) — 조회 시 signed()
    gen.setCreatedAt(java.time.Instant.now());
    referenceGenerationRepository.save(gen);

    // 생성 직후 프론트가 AuthedImage 로 바로 프리뷰 → prod s3:{key} 는 서명해야 로드된다.
    return java.util.Map.of("imageId", image.getId(), "url", signed(image.getUrl()));
  }

  /** SCRUM-118: 생성 대화 이력(프롬프트 → 이미지) — 보드 진입 시 생성 채팅 복원(시간순, url 은 서명해 신선하게). */
  public List<GenerationHistoryItem> generationHistory(User user, Long projectId) {
    pinnedImageIds(user, projectId); // 소유 검증 재활용(미소유면 throw)
    return referenceGenerationRepository
        .findByProjectIdAndUserIdOrderByCreatedAtAsc(projectId, user.getId())
        .stream()
        .map(
            g ->
                new GenerationHistoryItem(
                    g.getPrompt(), g.getImageId(), signed(g.getUrl()), g.getCreatedAt()))
        .toList();
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
