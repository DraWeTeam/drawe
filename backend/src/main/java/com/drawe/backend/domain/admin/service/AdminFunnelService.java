package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.FunnelPage;
import com.drawe.backend.domain.admin.dto.FunnelRow;
import com.drawe.backend.domain.admin.dto.RelevanceSummary;
import com.drawe.backend.domain.admin.repository.AdminAnalyticsRepository;
import com.drawe.backend.domain.admin.repository.AdminFunnelRepository;
import com.drawe.backend.domain.admin.repository.AdminFunnelRepository.FeedbackCounts;
import com.drawe.backend.domain.admin.repository.AdminFunnelRepository.FunnelProjection;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Engagement Funnel + 추천 적합도 조립. 읽기 전용. */
@Service
@RequiredArgsConstructor
public class AdminFunnelService {

  private static final int MIN_SIZE = 10;
  private static final int MAX_SIZE = 200;

  /** 능동 수집(active curation) 세그먼트 — 사용자가 직접 생성한 AI 이미지. 현재 기본 뷰. */
  public static final String SOURCE_GENERATED = "generated";

  /** 레거시 세그먼트 — 채팅 가이딩이 추천한 ref(references_json). 비교 기준으로만 접근 가능(기본 비노출). */
  public static final String SOURCE_GUIDING = "guiding";

  private final AdminFunnelRepository repo;
  private final AdminAnalyticsRepository analyticsRepo; // decision_keep/skip 카운트 재사용

  /**
   * 페이지네이션 + 검색 지원. page는 1-based. q null/blank → 빈 문자열로 정규화.
   *
   * <p>{@code source}에 따라 anchor가 달라진다: {@code generated}=생성 AI 이미지(images.source='AI'), {@code
   * guiding}=채팅 추천 ref(레거시). 그 외 값(예: 아직 로깅 미구현인 board)은 빈 페이지.
   */
  @Transactional(readOnly = true)
  public FunnelPage buildFunnel(int windowHours, int page, int size, String q, String source) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));
    int safePage = Math.max(1, page);
    int safeSize = Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
    String safeQ = q == null ? "" : q.trim();
    int offset = (safePage - 1) * safeSize;

    boolean guiding = SOURCE_GUIDING.equals(source);
    boolean generated = SOURCE_GENERATED.equals(source);
    if (!guiding && !generated) {
      // board 등 미구현 세그먼트 — Phase 2에서 노출 로깅이 들어오면 채워진다.
      return new FunnelPage(new ArrayList<>(), 0, safePage, safeSize, safeQ);
    }

    long total = guiding ? repo.funnelCount(since, safeQ) : repo.funnelGeneratedCount(since, safeQ);
    List<FunnelProjection> ps =
        guiding
            ? repo.funnel(since, safeQ, safeSize, offset)
            : repo.funnelGenerated(since, safeQ, safeSize, offset);
    List<FunnelRow> rows = new ArrayList<>();
    for (FunnelProjection p : ps) {
      long shown = p.getShown();
      rows.add(
          new FunnelRow(
              p.getImageId(),
              shown,
              p.getLikes(),
              p.getDislikes(),
              p.getSaves(),
              rate(p.getLikes(), shown),
              rate(p.getDislikes(), shown),
              rate(p.getSaves(), shown),
              p.getUrl(),
              p.getSource(),
              p.getPhotographer(),
              tagSummary(p)));
    }
    return new FunnelPage(rows, total, safePage, safeSize, safeQ);
  }

  @Transactional(readOnly = true)
  public RelevanceSummary buildSummary(int windowHours, String source) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));
    boolean guiding = SOURCE_GUIDING.equals(source);
    boolean generated = SOURCE_GENERATED.equals(source);
    if (!guiding && !generated) {
      return new RelevanceSummary(0, 0, 0, 0, null, null, null, 0, 0);
    }

    long shown = guiding ? repo.countShown(since) : repo.countGenerated(since);
    FeedbackCounts fc = guiding ? repo.feedbackCounts(since) : repo.feedbackCountsGenerated(since);
    long likes = num(fc.getLikes());
    long dislikes = num(fc.getDislikes());
    long saves = guiding ? repo.countSaves(since) : repo.countSavesGenerated(since);
    // decision_keep/skip은 채팅 키워드-추출 단계의 시스템 결정이라 생성 세그먼트엔 무의미 → 0.
    long keep = guiding ? analyticsRepo.countByType("decision_keep", since) : 0L;
    long skip = guiding ? analyticsRepo.countByType("decision_skip", since) : 0L;
    return new RelevanceSummary(
        shown,
        likes,
        dislikes,
        saves,
        rate(likes, shown),
        rate(dislikes, shown),
        rate(saves, shown),
        keep,
        skip);
  }

  private static Double rate(long n, long denom) {
    return denom > 0 ? (double) n / denom : null;
  }

  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }

  private static String tagSummary(FunnelProjection p) {
    List<String> parts = new ArrayList<>();
    if (notBlank(p.getTechnique())) {
      parts.add(p.getTechnique());
    }
    if (notBlank(p.getSubject())) {
      parts.add(p.getSubject());
    }
    if (notBlank(p.getMood())) {
      parts.add(p.getMood());
    }
    return String.join(" · ", parts);
  }

  private static boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }
}
