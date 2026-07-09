package com.drawe.backend.domain.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.drawe.backend.domain.admin.dto.GuideModel.FocusRow;
import com.drawe.backend.domain.admin.service.GuideQualityAnalyzer.FocusAgg;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 가이딩 품질 순수 계산(만족도·degraded율·신뢰도·축 정렬) 단위 테스트. */
class GuideQualityAnalyzerTest {

  @Test
  void 만족도_좋아요율() {
    // 좋아요 3, 싫어요 1 → 3/4 = 0.75
    assertThat(GuideQualityAnalyzer.satisfactionRate(3, 1)).isEqualTo(0.75);
  }

  @Test
  void 만족도_피드백_없으면_null_분모제외() {
    // 피드백을 남긴 가이드가 없으면(분모 0) null — 피드백 안 남긴 가이드는 애초에 분모에 없다.
    assertThat(GuideQualityAnalyzer.satisfactionRate(0, 0)).isNull();
    // 싫어요만 있어도 분모는 있음 → 0.0 (null 아님)
    assertThat(GuideQualityAnalyzer.satisfactionRate(0, 4)).isEqualTo(0.0);
  }

  @Test
  void degraded율() {
    // 2 degraded / 10 전체 = 0.2
    assertThat(GuideQualityAnalyzer.degradedRate(2, 10)).isEqualTo(0.2);
    // 가이드 0이면 null
    assertThat(GuideQualityAnalyzer.degradedRate(0, 0)).isNull();
  }

  @Test
  void 신뢰도_표본기준() {
    assertThat(GuideQualityAnalyzer.reliability(0, 10)).isEqualTo("none");
    assertThat(GuideQualityAnalyzer.reliability(9, 10)).isEqualTo("yellow");
    assertThat(GuideQualityAnalyzer.reliability(10, 10)).isEqualTo("green");
    assertThat(GuideQualityAnalyzer.reliability(50, 10)).isEqualTo("green");
  }

  @Test
  void 만족도_tone_임계미만_bad() {
    assertThat(GuideQualityAnalyzer.satisfactionTone(null, 0.70)).isEqualTo("muted");
    assertThat(GuideQualityAnalyzer.satisfactionTone(0.69, 0.70)).isEqualTo("bad");
    assertThat(GuideQualityAnalyzer.satisfactionTone(0.70, 0.70)).isEqualTo("good");
    assertThat(GuideQualityAnalyzer.satisfactionTone(0.90, 0.70)).isEqualTo("good");
  }

  @Test
  void degraded_tone_임계초과_bad() {
    assertThat(GuideQualityAnalyzer.degradedTone(null, 0.20)).isEqualTo("muted");
    assertThat(GuideQualityAnalyzer.degradedTone(0.21, 0.20)).isEqualTo("bad");
    assertThat(GuideQualityAnalyzer.degradedTone(0.20, 0.20)).isEqualTo("good");
    assertThat(GuideQualityAnalyzer.degradedTone(0.05, 0.20)).isEqualTo("good");
  }

  @Test
  void 축분포_가이드수_내림차순_정렬_상위N() {
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
  void 축분포_동수는_라벨_오름차순_안정정렬() {
    List<FocusRow> rows =
        GuideQualityAnalyzer.topFocus(
            List.of(new FocusAgg("zeta", 4), new FocusAgg("alpha", 4)), 10);
    assertThat(rows).extracting(FocusRow::label).containsExactly("alpha", "zeta");
  }

  @Test
  void 축분포_빈입력_안전() {
    assertThat(GuideQualityAnalyzer.topFocus(List.of(), 5)).isEmpty();
    assertThat(GuideQualityAnalyzer.topFocus(null, 5)).isEmpty();
  }
}
