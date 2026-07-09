package com.drawe.backend.domain.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.drawe.backend.domain.admin.dto.GuideModel.FocusRow;
import com.drawe.backend.domain.admin.service.GuideQualityAnalyzer.FocusAgg;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 가이딩 품질 순수 계산(만족도·degraded율·신뢰도·축 정렬) 단위 테스트. */
class GuideQualityAnalyzerTest {

  @Test
  @DisplayName("만족도_좋아요율")
  void satisfactionRateFromLikes() {
    // 좋아요 3, 싫어요 1 → 3/4 = 0.75
    assertThat(GuideQualityAnalyzer.satisfactionRate(3, 1)).isEqualTo(0.75);
  }

  @Test
  @DisplayName("만족도_피드백_없으면_null_분모제외")
  void satisfactionRateNullWhenNoFeedback() {
    // 피드백을 남긴 가이드가 없으면(분모 0) null — 피드백 안 남긴 가이드는 애초에 분모에 없다.
    assertThat(GuideQualityAnalyzer.satisfactionRate(0, 0)).isNull();
    // 싫어요만 있어도 분모는 있음 → 0.0 (null 아님)
    assertThat(GuideQualityAnalyzer.satisfactionRate(0, 4)).isEqualTo(0.0);
  }

  @Test
  @DisplayName("degraded율")
  void degradedRate() {
    // 2 degraded / 10 전체 = 0.2
    assertThat(GuideQualityAnalyzer.degradedRate(2, 10)).isEqualTo(0.2);
    // 가이드 0이면 null
    assertThat(GuideQualityAnalyzer.degradedRate(0, 0)).isNull();
  }

  @Test
  @DisplayName("신뢰도_표본기준")
  void reliabilityBySampleSize() {
    assertThat(GuideQualityAnalyzer.reliability(0, 10)).isEqualTo("none");
    assertThat(GuideQualityAnalyzer.reliability(9, 10)).isEqualTo("yellow");
    assertThat(GuideQualityAnalyzer.reliability(10, 10)).isEqualTo("green");
    assertThat(GuideQualityAnalyzer.reliability(50, 10)).isEqualTo("green");
  }

  @Test
  @DisplayName("만족도_tone_임계미만_bad")
  void satisfactionToneBadBelowThreshold() {
    assertThat(GuideQualityAnalyzer.satisfactionTone(null, 0.70)).isEqualTo("muted");
    assertThat(GuideQualityAnalyzer.satisfactionTone(0.69, 0.70)).isEqualTo("bad");
    assertThat(GuideQualityAnalyzer.satisfactionTone(0.70, 0.70)).isEqualTo("good");
    assertThat(GuideQualityAnalyzer.satisfactionTone(0.90, 0.70)).isEqualTo("good");
  }

  @Test
  @DisplayName("degraded_tone_임계초과_bad")
  void degradedToneBadAboveThreshold() {
    assertThat(GuideQualityAnalyzer.degradedTone(null, 0.20)).isEqualTo("muted");
    assertThat(GuideQualityAnalyzer.degradedTone(0.21, 0.20)).isEqualTo("bad");
    assertThat(GuideQualityAnalyzer.degradedTone(0.20, 0.20)).isEqualTo("good");
    assertThat(GuideQualityAnalyzer.degradedTone(0.05, 0.20)).isEqualTo("good");
  }

  @Test
  @DisplayName("축분포_가이드수_내림차순_정렬_상위N")
  void topFocusSortedByCountDescTopN() {
    List<FocusRow> rows =
        GuideQualityAnalyzer.topFocus(
            List.of(
                new FocusAgg("hand", 3),
                new FocusAgg("face", 10),
                new FocusAgg("pose", 5)),
            2);
    // 상위 2개, 내림차순: face(10) → pose(5)
    assertThat(rows).extracting(FocusRow::label).containsExactly("face", "pose");
    assertThat(rows.get(0).count()).isEqualTo(10);
    // share = 10 / (3+10+5=18)
    assertThat(rows.get(0).share()).isCloseTo(10.0 / 18, within(1e-9));
  }

  @Test
  @DisplayName("축분포_동수는_라벨_오름차순_안정정렬")
  void topFocusStableSortByLabelWhenTied() {
    List<FocusRow> rows =
        GuideQualityAnalyzer.topFocus(
            List.of(new FocusAgg("zeta", 4), new FocusAgg("alpha", 4)), 10);
    assertThat(rows).extracting(FocusRow::label).containsExactly("alpha", "zeta");
  }

  @Test
  @DisplayName("축분포_빈입력_안전")
  void topFocusSafeOnEmptyInput() {
    assertThat(GuideQualityAnalyzer.topFocus(List.of(), 5)).isEmpty();
    assertThat(GuideQualityAnalyzer.topFocus(null, 5)).isEmpty();
  }

  @Test
  @DisplayName("생성성공률_mode분포_coach비율")
  void successRateFromCoachShareOfModes() {
    // coach 8 / (coach8 + refused1 + clarify1) = 8/10 = 0.8
    List<FocusAgg> modes =
        List.of(new FocusAgg("coach", 8), new FocusAgg("refused", 1), new FocusAgg("clarify", 1));
    assertThat(GuideQualityAnalyzer.coachSuccessRate(modes)).isEqualTo(0.8);
    assertThat(GuideQualityAnalyzer.totalModes(modes)).isEqualTo(10);
  }

  @Test
  @DisplayName("생성성공률_대소문자_무관")
  void coachSuccessRateCaseInsensitive() {
    assertThat(GuideQualityAnalyzer.coachSuccessRate(List.of(new FocusAgg("COACH", 3))))
        .isEqualTo(1.0);
  }

  @Test
  @DisplayName("생성성공률_이벤트없으면_null")
  void coachSuccessRateNullWhenNoEvents() {
    assertThat(GuideQualityAnalyzer.coachSuccessRate(List.of())).isNull();
    assertThat(GuideQualityAnalyzer.coachSuccessRate(null)).isNull();
    assertThat(GuideQualityAnalyzer.totalModes(null)).isEqualTo(0);
  }

  @Test
  @DisplayName("재추천율")
  void rerollRate() {
    // reroll 3 / coach 12 = 0.25
    assertThat(GuideQualityAnalyzer.rerollRate(3, 12)).isEqualTo(0.25);
    // 생성 0이면 null(분모 0 안전)
    assertThat(GuideQualityAnalyzer.rerollRate(5, 0)).isNull();
    // 여러 번 재추천 → 100% 초과 가능
    assertThat(GuideQualityAnalyzer.rerollRate(15, 10)).isEqualTo(1.5);
  }

  @Test
  @DisplayName("성공률_tone_임계미만_bad_재추천_tone_임계초과_bad")
  void successAndRerollToneThresholds() {
    // 성공률은 만족도와 같은 로직(미만 bad) 재사용
    assertThat(GuideQualityAnalyzer.satisfactionTone(0.79, 0.80)).isEqualTo("bad");
    assertThat(GuideQualityAnalyzer.satisfactionTone(0.80, 0.80)).isEqualTo("good");
    // 재추천율은 degraded 와 같은 로직(초과 bad) 재사용
    assertThat(GuideQualityAnalyzer.degradedTone(0.31, 0.30)).isEqualTo("bad");
    assertThat(GuideQualityAnalyzer.degradedTone(0.30, 0.30)).isEqualTo("good");
  }
}
