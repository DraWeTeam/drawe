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

  private final AdminFunnelRepository repo;
  private final AdminAnalyticsRepository analyticsRepo; // decision_keep/skip 카운트 재사용

  /** 페이지네이션 + 검색 지원. page는 1-based. q null/blank → 빈 문자열로 정규화. */
  @Transactional(readOnly = true)
  public FunnelPage buildFunnel(int windowHours, int page, int size, String q) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));
    int safePage = Math.max(1, page);
    int safeSize = Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
    String safeQ = q == null ? "" : q.trim();
    int offset = (safePage - 1) * safeSize;

    long total = repo.funnelCount(since, safeQ);
    List<FunnelRow> rows = new ArrayList<>();
    for (FunnelProjection p : repo.funnel(since, safeQ, safeSize, offset)) {
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
  public RelevanceSummary buildSummary(int windowHours) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));
    long shown = repo.countShown(since);
    FeedbackCounts fc = repo.feedbackCounts(since);
    long likes = num(fc.getLikes());
    long dislikes = num(fc.getDislikes());
    long saves = repo.countSaves(since);
    long keep = analyticsRepo.countByType("decision_keep", since);
    long skip = analyticsRepo.countByType("decision_skip", since);
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
