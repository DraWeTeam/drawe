package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.OverviewKpi;
import com.drawe.backend.domain.admin.repository.AdminAnalyticsRepository;
import com.drawe.backend.domain.analytics.AnalyticsEventType;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Overview 탭 KPI 조립 — 비즈니스(사용량) 지표만. 읽기 전용.
 *
 * <p>응답 지연(latency p50/p95)·에러 분포(error_class)는 admin 책임에서 제외되어 observability로 이관됨. 같은 질문을 두 곳에서 세지
 * 않는다(횟수=metric / 원인=log / funnel=analytics).
 */
@Service
@RequiredArgsConstructor
public class AdminAnalyticsService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(KST);

  private final AdminAnalyticsRepository repo;

  @Transactional(readOnly = true)
  public OverviewKpi buildOverview(int windowHours) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));

    long activeUsers = repo.countActiveUsers(since);
    long chatStart = repo.countByType(AnalyticsEventType.CHAT_START, since);
    long chatSuccess = repo.countByType(AnalyticsEventType.CHAT_SUCCESS, since);
    long searchExecuted = repo.countByType(AnalyticsEventType.SEARCH_EXECUTED, since);

    List<OverviewKpi.EventTypeCount> distribution =
        repo.eventTypeDistribution(since).stream()
            .map(r -> new OverviewKpi.EventTypeCount(r.getEventType(), r.getCnt()))
            .toList();

    return new OverviewKpi(
        windowHours,
        TS.format(Instant.now()),
        activeUsers,
        chatStart,
        chatSuccess,
        searchExecuted,
        distribution);
  }
}
