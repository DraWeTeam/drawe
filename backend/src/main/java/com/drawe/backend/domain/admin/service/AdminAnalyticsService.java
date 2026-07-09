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
    long chatError = repo.countByType(AnalyticsEventType.CHAT_ERROR, since);
    long searchExecuted = repo.countByType(AnalyticsEventType.SEARCH_EXECUTED, since);
    long searchBlocked = repo.countByType(AnalyticsEventType.SEARCH_BLOCKED, since);

    // 성공률/에러율 분모 = success + error (턴 단위). chat_start(세션 단위)는 분모에 쓰지 않는다.
    Double successRate = rate(chatSuccess, chatSuccess + chatError);
    Double errorRate = rate(chatError, chatSuccess + chatError);
    Double searchBlockRate = rate(searchBlocked, searchExecuted + searchBlocked);

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
        chatError,
        searchExecuted,
        searchBlocked,
        successRate,
        errorRate,
        searchBlockRate,
        distribution);
  }

  /** 비율(0~100). 분모 0이면 null → 뷰에서 "—". */
  private static Double rate(long numerator, long denominator) {
    return denominator == 0 ? null : numerator * 100.0 / denominator;
  }
}
