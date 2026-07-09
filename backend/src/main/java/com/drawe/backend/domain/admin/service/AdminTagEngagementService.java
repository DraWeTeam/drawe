package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.TagEngagementModel.AxisRollup;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.CandidateRow;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.Gate;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.Hygiene;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.TagRow;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.View;
import com.drawe.backend.domain.admin.repository.AdminTagEngagementRepository;
import com.drawe.backend.domain.admin.repository.AdminTagEngagementRepository.PerImageRow;
import com.drawe.backend.global.client.Ga4ClickSource;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 태그별 레퍼런스 관심도 조립. 약신호 페이지 — 게이트로 신뢰도 판정 후 노출 보정 전환율로 순위를 낸다.
 *
 * <p>DB/GA4 집계만 여기서 하고 판단(전환율 정렬·게이트·점유율·사분면·위생)은 {@link TagEngagementAnalyzer}(순수 함수)에 위임한다.
 */
@Service
@RequiredArgsConstructor
public class AdminTagEngagementService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(KST);

  private final AdminTagEngagementRepository repo;
  private final Ga4ClickSource ga4;

  @Transactional(readOnly = true)
  public View build(int windowHours) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));

    List<PerImageRow> rows = repo.perImageEngagement(since);
    Map<Long, Long> clicks = ga4.clicksByImageId(since);
    boolean clicksAvailable = ga4.isAvailable();

    Map<String, Acc> technique = new LinkedHashMap<>();
    Map<String, Acc> subject = new LinkedHashMap<>();
    Map<String, Acc> mood = new LinkedHashMap<>();
    Set<String> allTagValues = new LinkedHashSet<>(); // 위생용(null/blank 포함)

    // 전체(이미지 단위) 합계 — 게이트·KO 분모. 축 합산은 3축 중복이라 쓰지 않는다.
    long totalShown = 0;
    long totalLikes = 0;
    long totalPins = 0;
    long totalClicks = 0;

    for (PerImageRow r : rows) {
      long shown = num(r.getShown());
      long likes = num(r.getLikes());
      long pins = num(r.getPins());

      totalShown += shown;
      totalLikes += likes;
      totalPins += pins;
      long click = clicks.getOrDefault(r.getImageId(), 0L);
      totalClicks += click;

      add(technique, r.getTechnique(), shown, click, likes, pins);
      add(subject, r.getSubject(), shown, click, likes, pins);
      add(mood, r.getMood(), shown, click, likes, pins);

      allTagValues.add(r.getTechnique());
      allTagValues.add(r.getSubject());
      allTagValues.add(r.getMood());
    }

    AxisRollup techRollup = rollup("technique", technique);
    AxisRollup subjRollup = rollup("subject", subject);
    AxisRollup moodRollup = rollup("mood", mood);
    List<AxisRollup> axes = List.of(techRollup, subjRollup, moodRollup);

    // Guardrail — 전 축 중 최대 노출 점유율과 그 축.
    double maxAxisShare = 0;
    String maxShareAxis = null;
    for (AxisRollup a : axes) {
      double share = a.maxShare() == null ? 0 : a.maxShare();
      if (share > maxAxisShare) {
        maxAxisShare = share;
        maxShareAxis = a.axis();
      }
    }

    Gate gate =
        TagEngagementAnalyzer.judge(
            totalShown, totalLikes, totalPins, totalClicks, clicksAvailable, maxAxisShare);
    Double ko =
        TagEngagementAnalyzer.conversionRate(totalClicks, totalLikes, totalPins, totalShown);
    String koReliability = "green".equals(gate.level()) ? "green" : "yellow";

    List<CandidateRow> candidates = new ArrayList<>();
    for (AxisRollup a : axes) {
      candidates.addAll(TagEngagementAnalyzer.supplyGapCandidates(a.axis(), a.rows()));
    }

    Hygiene hygiene = TagEngagementAnalyzer.hygiene(allTagValues);

    return new View(
        TS.format(Instant.now()),
        clicksAvailable,
        gate,
        ko,
        koReliability,
        maxAxisShare,
        maxShareAxis,
        maxAxisShare > 0.5,
        axes,
        candidates,
        hygiene);
  }

  private AxisRollup rollup(String axis, Map<String, Acc> bucket) {
    List<TagRow> out = new ArrayList<>(bucket.size());
    for (Map.Entry<String, Acc> e : bucket.entrySet()) {
      Acc a = e.getValue();
      Double ctr = a.shown > 0 ? (double) a.clicks / a.shown : null;
      Double conv = TagEngagementAnalyzer.conversionRate(a.clicks, a.likes, a.pins, a.shown);
      out.add(new TagRow(e.getKey(), a.images, a.shown, a.clicks, a.likes, a.pins, ctr, conv));
    }
    TagEngagementAnalyzer.sortByConversion(out); // 노출 보정 전환율 내림차순
    return new AxisRollup(
        axis, out, TagEngagementAnalyzer.maxShare(out), TagEngagementAnalyzer.topTag(out));
  }

  /** 태그 값 null/blank 는 축 버킷에 넣지 않는다(태그 안 달린 이미지). */
  private void add(
      Map<String, Acc> bucket, String value, long shown, long click, long like, long pin) {
    if (value == null || value.isBlank()) {
      return;
    }
    Acc a = bucket.computeIfAbsent(value, k -> new Acc());
    a.images++;
    a.shown += shown;
    a.clicks += click;
    a.likes += like;
    a.pins += pin;
  }

  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }

  private static final class Acc {
    long images;
    long shown;
    long clicks;
    long likes;
    long pins;
  }
}
