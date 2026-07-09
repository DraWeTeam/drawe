package com.drawe.backend.domain.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.drawe.backend.domain.admin.dto.TagEngagementModel.CandidateRow;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.Gate;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.Hygiene;
import com.drawe.backend.domain.admin.dto.TagEngagementModel.TagRow;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 태그 관심도 판정 순수 함수 단위 테스트 — 전환율 정렬·게이트·점유율·사분면·위생. */
class TagEngagementAnalyzerTest {

  private static TagRow row(String v, long shown, long clicks, long likes, long pins) {
    return new TagRow(
        v,
        1,
        shown,
        clicks,
        likes,
        pins,
        shown > 0 ? (double) clicks / shown : null,
        TagEngagementAnalyzer.conversionRate(clicks, likes, pins, shown));
  }

  @Test
  @DisplayName("전환율_계산_노출0이면_null")
  void conversionRateNullWhenZeroShown() {
    assertThat(TagEngagementAnalyzer.conversionRate(1, 2, 3, 10)).isEqualTo(0.6);
    assertThat(TagEngagementAnalyzer.conversionRate(1, 2, 3, 0)).isNull();
  }

  @Test
  @DisplayName("정렬_노출_크지만_반응_적은_태그가_위로_안감")
  void sortByConversionRanksLowVolumeHighRateAbove() {
    // A: 노출 1000, 좋아요 10 → 전환율 0.01, 절대점수 30
    // B: 노출 10,   좋아요 5  → 전환율 0.50, 절대점수 15
    // 절대점수로는 A>B 지만, 전환율 정렬은 B 가 위여야 한다.
    List<TagRow> rows = new ArrayList<>(List.of(row("A", 1000, 0, 10, 0), row("B", 10, 0, 5, 0)));
    TagEngagementAnalyzer.sortByConversion(rows);
    assertThat(rows.stream().map(TagRow::value)).containsExactly("B", "A");
  }

  @Test
  @DisplayName("정렬_노출0_전환율null은_맨뒤")
  void sortByConversionPutsNullRateLast() {
    List<TagRow> rows =
        new ArrayList<>(List.of(row("noShown", 0, 0, 5, 0), row("hasConv", 10, 0, 2, 0)));
    TagEngagementAnalyzer.sortByConversion(rows);
    assertThat(rows.get(rows.size() - 1).value()).isEqualTo("noShown");
  }

  @Test
  @DisplayName("게이트_그린_반응살아있고_쏠림없고_GA4연동")
  void gateGreenWhenEngagedNotSkewedWithGa4() {
    Gate g = TagEngagementAnalyzer.judge(100, 5, 3, 2, true, 0.4);
    assertThat(g.level()).isEqualTo("green");
    assertThat(g.warn()).isFalse();
  }

  @Test
  @DisplayName("게이트_그린_GA4미연동이어도_좋아요핀_있으면")
  void gateGreenWithoutGa4WhenLikesOrPins() {
    // 완화된 규칙: 클릭(GA4)은 필수 아님 — 좋아요·핀 있고 비쏠림이면 green
    Gate g = TagEngagementAnalyzer.judge(100, 5, 3, 0, false, 0.4);
    assertThat(g.level()).isEqualTo("green");
    // coverageText 엔 클릭 미연동 표기 유지
    assertThat(g.coverageText()).contains("미연동");
  }

  @Test
  @DisplayName("게이트_옐로_핀_반응이_약할때")
  void gateYellowWhenPinSignalWeak() {
    // 좋아요는 있지만 핀 0 → green 아님(빨강도 아님) → yellow
    Gate g = TagEngagementAnalyzer.judge(100, 5, 0, 3, true, 0.4);
    assertThat(g.level()).isEqualTo("yellow");
  }

  @Test
  @DisplayName("게이트_레드_노출만_있음")
  void gateRedWhenOnlyShown() {
    Gate g = TagEngagementAnalyzer.judge(100, 0, 0, 0, true, 0.3);
    assertThat(g.level()).isEqualTo("red");
  }

  @Test
  @DisplayName("게이트_레드_한태그_과반_쏠림")
  void gateRedWhenSingleTagMajoritySkew() {
    // 반응 신호가 있어도 쏠림(>=50%)이면 red
    Gate g = TagEngagementAnalyzer.judge(100, 9, 9, 9, true, 0.6);
    assertThat(g.level()).isEqualTo("red");
    assertThat(g.reasonText()).contains("절반");
  }

  @Test
  @DisplayName("노출_점유율_계산")
  void maxShareCalculation() {
    List<TagRow> rows =
        List.of(row("a", 50, 0, 0, 0), row("b", 30, 0, 0, 0), row("c", 20, 0, 0, 0));
    assertThat(TagEngagementAnalyzer.maxShare(rows)).isEqualTo(0.5);
    assertThat(TagEngagementAnalyzer.topTag(rows)).isEqualTo("a");
  }

  @Test
  @DisplayName("사분면_후보_공급부족과_과공급")
  void quadrantCandidatesUnderAndOverSupply() {
    // 노출/전환율 중앙값 기준: 전환율↑·노출↓ = 공급부족, 노출↑·전환율↓ = 과공급
    List<TagRow> rows =
        List.of(
            row("under", 10, 0, 8, 0), //  노출 낮고 전환율 높음(0.8) → 공급 부족
            row("over", 200, 0, 2, 0), //  노출 높고 전환율 낮음(0.01) → 과공급
            row("mid1", 50, 0, 5, 0),
            row("mid2", 80, 0, 6, 0));
    List<CandidateRow> cands = TagEngagementAnalyzer.supplyGapCandidates("mood", rows);
    assertThat(cands).anySatisfy(c -> assertThat(c.tag()).isEqualTo("under"));
    assertThat(cands)
        .filteredOn(c -> c.tag().equals("under"))
        .allSatisfy(c -> assertThat(c.kind()).isEqualTo("공급 부족"));
    assertThat(cands)
        .filteredOn(c -> c.tag().equals("over"))
        .allSatisfy(c -> assertThat(c.kind()).isEqualTo("과공급"));
  }

  @Test
  @DisplayName("사분면_표본적으면_빈목록")
  void quadrantEmptyWhenSampleTooSmall() {
    List<TagRow> rows = List.of(row("a", 10, 0, 1, 0), row("b", 20, 0, 2, 0));
    assertThat(TagEngagementAnalyzer.supplyGapCandidates("mood", rows)).isEmpty();
  }

  @Test
  @DisplayName("위생_테스트태그와_빈태그_별칭쌍")
  void hygieneTestTagsEmptyTagsAndAliasPairs() {
    Set<String> tags =
        new java.util.LinkedHashSet<>(
            Arrays.asList("dreamy", "몽환적인", "test", "portrait", null, "  "));
    Hygiene h = TagEngagementAnalyzer.hygiene(tags);
    assertThat(h.testLikeTags()).contains("test", "(빈 태그)");
    assertThat(h.aliasSuspects()).anySatisfy(p -> assertThat(p.a()).isEqualTo("dreamy"));
  }
}
