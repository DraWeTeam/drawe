package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.OverviewKpi;
import com.drawe.backend.domain.admin.repository.AdminAnalyticsRepository;
import com.drawe.backend.domain.analytics.AnalyticsEventType;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Overview 탭 KPI를 한 번에 조립. 전부 읽기 전용. */
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
    long chatError = repo.countByType(AnalyticsEventType.CHAT_ERROR, since);
    long searchExecuted = repo.countByType(AnalyticsEventType.SEARCH_EXECUTED, since);
    long searchBlocked = repo.countByType(AnalyticsEventType.SEARCH_BLOCKED, since);

    Double successRate = ratio(chatSuccess, chatSuccess + chatError);
    Double blockRate = ratio(searchBlocked, searchExecuted + searchBlocked);

    List<Long> latencies =
        repo.findChatLatencies(since).stream()
            .filter(Objects::nonNull)
            .map(Number::longValue)
            .sorted()
            .toList();

    Long avg = null;
    Long p50 = null;
    Long p95 = null;
    Long max = null;
    if (!latencies.isEmpty()) {
      long sum = latencies.stream().mapToLong(Long::longValue).sum();
      avg = sum / latencies.size();
      p50 = percentile(latencies, 50);
      p95 = percentile(latencies, 95);
      max = latencies.get(latencies.size() - 1);
    }

    List<OverviewKpi.EventTypeCount> distribution =
        repo.eventTypeDistribution(since).stream()
            .map(r -> new OverviewKpi.EventTypeCount(r.getEventType(), r.getCnt()))
            .toList();

    List<OverviewKpi.ErrorClassCount> topErrors =
        repo.topErrorClasses(since).stream()
            .map(
                r ->
                    new OverviewKpi.ErrorClassCount(
                        r.getErrorClass() != null ? r.getErrorClass() : "(unknown)", r.getCnt()))
            .toList();

    return new OverviewKpi(
        windowHours,
        TS.format(Instant.now()),
        activeUsers,
        chatStart,
        chatSuccess,
        chatError,
        successRate,
        searchExecuted,
        searchBlocked,
        blockRate,
        avg,
        p50,
        p95,
        max,
        latencies.size(),
        distribution,
        topErrors);
  }

  /** 분모가 0이면 null (화면에서 "—"). */
  private static Double ratio(long numerator, long denominator) {
    if (denominator <= 0) {
      return null;
    }
    return (double) numerator / (double) denominator;
  }

  /**
   * 정렬된 리스트에서 p번째 백분위 값 (nearest-rank). 표본이 작은 베타에서 충분.
   *
   * @param sortedAsc 오름차순 정렬된 비어있지 않은 리스트
   * @param p 0~100
   */
  private static Long percentile(List<Long> sortedAsc, int p) {
    int n = sortedAsc.size();
    int rank = (int) Math.ceil(p / 100.0 * n);
    int idx = Math.min(Math.max(rank - 1, 0), n - 1);
    return sortedAsc.get(idx);
  }
}
