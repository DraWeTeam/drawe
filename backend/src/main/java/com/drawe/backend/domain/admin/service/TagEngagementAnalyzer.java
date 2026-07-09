package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.TagEngagementModel.AliasPair;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.CandidateRow;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.Gate;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.Hygiene;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.TagRow;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 태그 관심도 판정 로직 — 순수 함수(상태·I/O 없음 → 테스트 용이).
 *
 * <p>노출 보정 전환율 정렬 · 게이트 판정 · 노출 점유율(Guardrail) · 공급-관심 갭 사분면 · 태그 위생. 서비스는 DB/GA4 집계만 하고 판단은 여기에
 * 위임한다.
 */
public final class TagEngagementAnalyzer {

  private TagEngagementAnalyzer() {}

  private static final double SKEW_THRESHOLD = 0.5; // 한 태그 노출 점유율 과반
  private static final int QUADRANT_MIN = 4; // 사분면 후보를 낼 최소 태그 수

  /** 노출 보정 전환율 = (클릭+좋아요+핀)/노출. 노출 0이면 null. */
  public static Double conversionRate(long clicks, long likes, long pins, long shown) {
    return shown > 0 ? (double) (clicks + likes + pins) / shown : null;
  }

  /** 절대 관심 점수(강등된 tiebreak). */
  public static double engagementScore(long clicks, long likes, long pins) {
    return clicks * 2 + likes * 3 + pins * 4;
  }

  /** 전환율 내림차순 정렬(노출 0=전환율 null 은 맨 뒤). 동률은 절대 점수 내림차순. */
  public static void sortByConversion(List<TagRow> rows) {
    rows.sort(
        Comparator.comparingDouble((TagRow t) -> t.conversionRate() == null ? -1d : t.conversionRate())
            .reversed()
            .thenComparing(
                Comparator.comparingDouble(
                        (TagRow t) -> engagementScore(t.clicks(), t.likes(), t.pins()))
                    .reversed()));
  }

  /** 한 축의 최대 노출 점유율(top shown / total shown). total 0 이면 0. */
  public static double maxShare(List<TagRow> rows) {
    long total = rows.stream().mapToLong(TagRow::shown).sum();
    if (total == 0) {
      return 0d;
    }
    long max = rows.stream().mapToLong(TagRow::shown).max().orElse(0L);
    return (double) max / total;
  }

  public static String topTag(List<TagRow> rows) {
    return rows.stream().max(Comparator.comparingLong(TagRow::shown)).map(TagRow::value).orElse(null);
  }

  /**
   * 게이트 판정. 커버리지(노출/좋아요/핀/클릭)와 쏠림(maxAxisShare)으로 green/yellow/red.
   *
   * <p>green = 좋아요·핀 살아있고 + 쏠림 없음(클릭은 필수 아님). 노출만 있거나 한 태그 과반이면 red. 클릭 미연동은 레벨을 낮추지 않고 coverageText 에만 표기.
   */
  public static Gate judge(
      long shownSum,
      long likesSum,
      long pinsSum,
      long clicksSum,
      boolean clicksAvailable,
      double maxAxisShare) {
    String coverage =
        "노출 "
            + (shownSum > 0 ? "있음" : "없음")
            + " · 좋아요 "
            + likesSum
            + " · 핀 "
            + pinsSum
            + " · 클릭 "
            + (clicksAvailable ? String.valueOf(clicksSum) : "미연동");

    if (shownSum == 0) {
      return new Gate("red", coverage, "노출 데이터가 없어요.");
    }
    if (maxAxisShare >= SKEW_THRESHOLD) {
      return new Gate(
          "red",
          coverage,
          "한 태그가 노출의 절반 이상을 차지해요 — 태그 간 비교가 왜곡돼요.");
    }
    if (likesSum == 0 && pinsSum == 0 && clicksSum == 0) {
      return new Gate("red", coverage, "노출만 있고 좋아요·핀·클릭이 전혀 없어요.");
    }
    // green — 좋아요·핀 반응이 살아있고 쏠림 없으면 green. 클릭(GA4)은 필수 아님(미연동은 레벨을 낮추지 않고 coverageText 에만 표기).
    if (likesSum > 0 && pinsSum > 0) {
      return new Gate("green", coverage, "반응 신호가 살아있고 특정 태그 쏠림도 없어요.");
    }
    return new Gate("yellow", coverage, "좋아요·핀 반응이 아직 약해 방향만 참고하세요.");
  }

  /**
   * 공급-관심 갭 후보(축 중앙값 기준 사분면). 전환율↑·노출↓ = "공급 부족", 노출↑·전환율↓ = "과공급". 표본이 적으면(&lt;4) 빈 목록.
   */
  public static List<CandidateRow> supplyGapCandidates(String axis, List<TagRow> rows) {
    List<TagRow> withShown =
        rows.stream().filter(r -> r.shown() > 0 && r.conversionRate() != null).toList();
    if (withShown.size() < QUADRANT_MIN) {
      return List.of();
    }
    double medConv =
        median(withShown.stream().map(TagRow::conversionRate).sorted().toList());
    double medShown =
        median(withShown.stream().map(r -> (double) r.shown()).sorted().toList());

    List<CandidateRow> out = new ArrayList<>();
    for (TagRow r : withShown) {
      if (r.conversionRate() > medConv && r.shown() < medShown) {
        out.add(new CandidateRow(axis, r.value(), r.conversionRate(), r.shown(), "공급 부족"));
      } else if (r.shown() > medShown && r.conversionRate() < medConv) {
        out.add(new CandidateRow(axis, r.value(), r.conversionRate(), r.shown(), "과공급"));
      }
    }
    return out;
  }

  private static double median(List<Double> sorted) {
    int n = sorted.size();
    if (n == 0) {
      return 0d;
    }
    return n % 2 == 1
        ? sorted.get(n / 2)
        : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2d;
  }

  // ── 태그 위생 ──────────────────────────────────────────
  private static final Set<String> TEST_LIKE =
      Set.of("test", "테스트", "none", "null", "n/a", "na", "tmp", "temp", "-", "undefined");

  /** 정적 한영 별칭 후보(예시 — 자동 병합 아님, 표시만). 필요 시 추가. */
  private static final List<AliasPair> ALIAS_DICT =
      List.of(
          new AliasPair("dreamy", "몽환적인"),
          new AliasPair("warm", "따뜻한"),
          new AliasPair("cool", "차가운"),
          new AliasPair("soft", "부드러운"),
          new AliasPair("portrait", "인물"),
          new AliasPair("landscape", "풍경"));

  /** test/빈 태그 목록 + 정적 별칭 사전에서 양쪽 다 등장하는 쌍. */
  public static Hygiene hygiene(Set<String> allTags) {
    Set<String> lower = new LinkedHashSet<>();
    for (String t : allTags) {
      if (t != null) {
        lower.add(t.trim().toLowerCase(Locale.ROOT));
      }
    }
    List<String> testLike = new ArrayList<>();
    for (String t : allTags) {
      if (t == null || t.isBlank() || TEST_LIKE.contains(t.trim().toLowerCase(Locale.ROOT))) {
        testLike.add(t == null || t.isBlank() ? "(빈 태그)" : t);
      }
    }
    List<AliasPair> suspects = new ArrayList<>();
    for (AliasPair p : ALIAS_DICT) {
      if (lower.contains(p.a().toLowerCase(Locale.ROOT)) && lower.contains(p.b())) {
        suspects.add(p);
      }
    }
    return new Hygiene(testLike, suspects);
  }
}
