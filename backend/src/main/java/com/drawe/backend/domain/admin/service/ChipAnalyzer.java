package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.ChipModel.ChipRow;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 칩 노출/반영 조인·전환율·정렬 — 순수 함수(상태·I/O 없음 → 테스트 용이).
 *
 * <p>라벨을 정규화(trim·lowercase)해 노출({@code chip_shown})과
 * 반영({@code projects.keywords})을 조인한다. <b>정렬은 노출
 * 보정 전환율</b>(반영/노출) 내림차순 — 절대 반영수로 정렬하지 않는다(어절 랭킹과 같은 함정 방지). 노출 0(미기록)은 전환율 null 로 맨 뒤.
 */
public final class ChipAnalyzer {

  private ChipAnalyzer() {}

  /** 노출 집계 입력 — (라벨, 노출수, 평균 position). */
  public record ShownAgg(String label, long count, double avgPosition) {}

  /** 반영 집계 입력 — (라벨, 반영수). */
  public record ReflectAgg(String label, long count) {}

  private static String norm(String label) {
    return label == null ? "" : label.trim().toLowerCase(Locale.ROOT);
  }

  /** 정규화 라벨 기준 노출·반영 조인 후 전환율 내림차순 정렬된 행 목록. */
  public static List<ChipRow> join(List<ShownAgg> shown, List<ReflectAgg> reflect) {
    Map<String, ShownMerge> shownMap = new LinkedHashMap<>();
    if (shown != null) {
      for (ShownAgg s : shown) {
        String key = norm(s.label());
        if (key.isEmpty()) {
          continue;
        }
        ShownMerge m = shownMap.computeIfAbsent(key, k -> new ShownMerge(s.label()));
        m.count += s.count();
        m.weightedPosSum += s.count() * s.avgPosition();
      }
    }
    Map<String, ReflectMerge> reflectMap = new LinkedHashMap<>();
    if (reflect != null) {
      for (ReflectAgg r : reflect) {
        String key = norm(r.label());
        if (key.isEmpty()) {
          continue;
        }
        ReflectMerge m = reflectMap.computeIfAbsent(key, k -> new ReflectMerge(r.label()));
        m.count += r.count();
      }
    }

    // 두 맵의 키 합집합
    Map<String, Boolean> keys = new LinkedHashMap<>();
    shownMap.keySet().forEach(k -> keys.put(k, true));
    reflectMap.keySet().forEach(k -> keys.put(k, true));

    List<ChipRow> rows = new ArrayList<>(keys.size());
    for (String key : keys.keySet()) {
      ShownMerge sm = shownMap.get(key);
      ReflectMerge rm = reflectMap.get(key);
      long shownCount = sm == null ? 0 : sm.count;
      long reflectCount = rm == null ? 0 : rm.count;
      String display = sm != null ? sm.display : rm.display;
      Double avgPos = shownCount > 0 ? sm.weightedPosSum / shownCount : null;
      Double rate = shownCount > 0 ? (double) reflectCount / shownCount : null; // 노출 0 = 미기록 → null
      boolean unmeasured = shownCount == 0 && reflectCount > 0;
      rows.add(new ChipRow(display, shownCount, reflectCount, rate, avgPos, unmeasured));
    }

    rows.sort(
        Comparator.comparingDouble((ChipRow r) -> r.reflectRate() == null ? -1d : r.reflectRate())
            .reversed()
            .thenComparingLong(r -> -r.reflect())); // 동률은 절대 반영수 내림차순
    return rows;
  }

  private static final class ShownMerge {
    final String display;
    long count;
    double weightedPosSum;

    ShownMerge(String display) {
      this.display = display;
    }
  }

  private static final class ReflectMerge {
    final String display;
    long count;

    ReflectMerge(String display) {
      this.display = display;
    }
  }
}
