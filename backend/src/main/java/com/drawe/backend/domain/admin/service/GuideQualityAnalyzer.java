package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.GuideModel.FocusRow;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 가이딩 품질 순수 계산 — 만족도(좋아요율)·degraded율·신뢰도·축 분포 정렬. DB·시간·프레임워크 의존 없음(단위 테스트 용이).
 */
public final class GuideQualityAnalyzer {

  private GuideQualityAnalyzer() {}

  /**
   * 만족도 = 좋아요 / (좋아요 + 싫어요). 피드백이 하나도 없으면 {@code null}(분모 0).
   *
   * <p>피드백을 남기지 '않은' 가이드는 분모에 넣지 않는다 — guide_feedback 행이 있는 것만 집계되므로 자연히 제외된다.
   */
  public static Double satisfactionRate(long likes, long dislikes) {
    long denom = likes + dislikes;
    return denom > 0 ? (double) likes / denom : null;
  }

  /** degraded 비율 = degraded 가이드 / 전체 가이드. 가이드가 하나도 없으면 {@code null}. */
  public static Double degradedRate(long degraded, long total) {
    return total > 0 ? (double) degraded / total : null;
  }

  /**
   * 표본 수 기준 신뢰도. 표본 0 → {@code none}("측정 안 됨"), 임계 미만 → {@code yellow}("방향만"), 이상 → {@code
   * green}("신뢰").
   */
  public static String reliability(long sample, long lowDataThreshold) {
    if (sample <= 0) {
      return "none";
    }
    return sample < lowDataThreshold ? "yellow" : "green";
  }

  /** 만족도 값 색(tone). 표본 없으면 muted, 임계 미만이면 bad(빨강), 이상이면 good. */
  public static String satisfactionTone(Double rate, double badBelow) {
    if (rate == null) {
      return "muted";
    }
    return rate < badBelow ? "bad" : "good";
  }

  /** degraded 값 색(tone). 표본 없으면 muted, 임계 초과면 bad(빨강), 이하면 good. */
  public static String degradedTone(Double rate, double badAbove) {
    if (rate == null) {
      return "muted";
    }
    return rate > badAbove ? "bad" : "good";
  }

  /**
   * 축 분포를 가이드 수 내림차순으로 정렬하고 상위 {@code topN}만 남긴다. 각 행에 전체 대비 비율(share)을 채운다. 동수는 라벨 오름차순으로 안정 정렬.
   *
   * @param raw (label, count) 원자료 — DB 집계 결과(순서 무관)
   * @param topN 최대 표시 개수
   */
  public static List<FocusRow> topFocus(List<FocusAgg> raw, int topN) {
    if (raw == null || raw.isEmpty()) {
      return List.of();
    }
    long total = raw.stream().mapToLong(FocusAgg::count).sum();
    List<FocusAgg> sorted = new ArrayList<>(raw);
    sorted.sort(
        Comparator.comparingLong(FocusAgg::count)
            .reversed()
            .thenComparing(a -> a.label() == null ? "" : a.label()));
    List<FocusRow> out = new ArrayList<>();
    for (FocusAgg a : sorted) {
      if (out.size() >= topN) {
        break;
      }
      Double share = total > 0 ? (double) a.count() / total : null;
      out.add(new FocusRow(a.label(), a.count(), share));
    }
    return out;
  }

  /** 축 분포 원자료(정렬 전). */
  public record FocusAgg(String label, long count) {}
}
