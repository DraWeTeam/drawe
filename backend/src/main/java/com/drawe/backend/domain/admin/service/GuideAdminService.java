package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.GuideModel.DailyRow;
import com.drawe.backend.domain.admin.dto.GuideModel.FocusRow;
import com.drawe.backend.domain.admin.dto.GuideModel.TaskRow;
import com.drawe.backend.domain.admin.dto.GuideModel.View;
import com.drawe.backend.domain.admin.repository.AdminGuideRepository;
import com.drawe.backend.domain.admin.repository.AdminGuideRepository.FeedbackRow;
import com.drawe.backend.domain.admin.repository.AdminGuideRepository.GuideCountRow;
import com.drawe.backend.domain.admin.service.GuideQualityAnalyzer.FocusAgg;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 가이딩 탭 조립 — 이미지 기반 한 끗 가이드의 품질(만족도·품질 저하·축 분포·생성 추이). DB 집계만 하고 비율·신뢰도·정렬은 {@link
 * GuideQualityAnalyzer}(순수 함수)에 위임. 계측 추가 없음(어드민 DB의 guides/guide_feedback 만).
 */
@Service
@RequiredArgsConstructor
public class GuideAdminService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(KST);

  /** 피드백 표본이 이 미만이면 만족도 해석 주의(방향만). */
  private static final long FEEDBACK_LOW_DATA = 10;

  /** 만족도가 이 미만이면 경고색(빨강). */
  private static final double SATISFACTION_BAD_BELOW = 0.70;

  /** degraded 비율이 이 초과면 경고색(빨강). */
  private static final double DEGRADED_BAD_ABOVE = 0.20;

  /** 생성 성공률이 이 미만이면 경고색(빨강). */
  private static final double SUCCESS_BAD_BELOW = 0.80;

  /** 재추천율이 이 초과면 경고색(빨강) — 첫 추천 아쉬움 신호. */
  private static final double REROLL_BAD_ABOVE = 0.30;

  /** guide_result 이벤트가 이 미만이면 성공률/재추천율 해석 주의(계측 최근 시작). */
  private static final long RESULT_LOW_DATA = 10;

  /** 축 분포 표시 상위 개수. */
  private static final int FOCUS_TOP_N = 12;

  private final AdminGuideRepository repo;

  @Transactional(readOnly = true)
  public View build(int windowHours) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));

    GuideCountRow count = repo.countKpi(since);
    long guideCount = num(count.getTotal());
    long degradedCount = num(count.getDegraded());

    FeedbackRow fb = repo.feedbackKpi(since);
    long likes = num(fb.getLikes());
    long dislikes = num(fb.getDislikes());
    long feedbackTotal = likes + dislikes;

    Double satisfaction = GuideQualityAnalyzer.satisfactionRate(likes, dislikes);
    String satisfactionReliability =
        GuideQualityAnalyzer.reliability(feedbackTotal, FEEDBACK_LOW_DATA);
    String satisfactionTone =
        GuideQualityAnalyzer.satisfactionTone(satisfaction, SATISFACTION_BAD_BELOW);
    boolean lowData = feedbackTotal > 0 && feedbackTotal < FEEDBACK_LOW_DATA;

    Double degradedRate = GuideQualityAnalyzer.degradedRate(degradedCount, guideCount);
    // degraded 는 직접 측정치라, 가이드가 있으면 신뢰(green), 없으면 측정 안 됨(none).
    String degradedReliability = guideCount > 0 ? "green" : "none";
    String degradedTone = GuideQualityAnalyzer.degradedTone(degradedRate, DEGRADED_BAD_ABOVE);

    List<FocusAgg> focusRaw =
        repo.focusDistribution(since).stream()
            .map(p -> new FocusAgg(p.getFocus(), num(p.getCnt())))
            .toList();
    List<FocusRow> focusRows = GuideQualityAnalyzer.topFocus(focusRaw, FOCUS_TOP_N);

    List<DailyRow> dailyRows =
        repo.dailyGuides(since).stream()
            .map(p -> new DailyRow(p.getDay(), num(p.getCnt())))
            .toList();

    List<TaskRow> taskRows =
        repo.taskCountDistribution(since).stream()
            .map(p -> new TaskRow((int) num(p.getTasks()), num(p.getCnt())))
            .toList();

    // ── WP8-b: 생성 성공률(guide_result mode 분포) + 재추천율(guide_reroll) ──
    List<FocusAgg> modeAgg =
        repo.modeDistribution(since).stream()
            .map(p -> new FocusAgg(p.getMode(), num(p.getCnt())))
            .toList();
    long resultTotal = GuideQualityAnalyzer.totalModes(modeAgg);
    long coachCount =
        modeAgg.stream().filter(m -> "coach".equalsIgnoreCase(m.label())).mapToLong(FocusAgg::count).sum();
    Double successRate = GuideQualityAnalyzer.coachSuccessRate(modeAgg);
    String successReliability = GuideQualityAnalyzer.reliability(resultTotal, RESULT_LOW_DATA);
    String successTone = GuideQualityAnalyzer.satisfactionTone(successRate, SUCCESS_BAD_BELOW);
    List<FocusRow> modeRows = GuideQualityAnalyzer.topFocus(modeAgg, modeAgg.size());

    long rerollCount = repo.rerollCount(since);
    Double rerollRate = GuideQualityAnalyzer.rerollRate(rerollCount, coachCount);
    // 재추천율 신뢰도는 분모(coach 생성 수) 표본 기준.
    String rerollReliability = GuideQualityAnalyzer.reliability(coachCount, RESULT_LOW_DATA);
    String rerollTone = GuideQualityAnalyzer.degradedTone(rerollRate, REROLL_BAD_ABOVE);
    boolean instrumentationLowData = resultTotal > 0 && resultTotal < RESULT_LOW_DATA;

    return new View(
        TS.format(Instant.now()),
        guideCount,
        likes,
        dislikes,
        satisfaction,
        satisfactionReliability,
        satisfactionTone,
        degradedCount,
        degradedRate,
        degradedReliability,
        degradedTone,
        lowData,
        resultTotal,
        coachCount,
        successRate,
        successReliability,
        successTone,
        rerollCount,
        rerollRate,
        rerollReliability,
        rerollTone,
        instrumentationLowData,
        modeRows,
        focusRows,
        dailyRows,
        taskRows);
  }

  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }
}
