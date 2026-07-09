package com.drawe.backend.domain.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.drawe.backend.domain.admin.dto.ChipModel.ChipRow;
import com.drawe.backend.domain.admin.service.ChipAnalyzer.ReflectAgg;
import com.drawe.backend.domain.admin.service.ChipAnalyzer.ShownAgg;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 칩 노출/반영 조인·전환율·정렬 순수 함수 단위 테스트. */
class ChipAnalyzerTest {

  @Test
  @DisplayName("정규화_조인_대소문자")
  void joinsCaseInsensitively() {
    List<ChipRow> rows =
        ChipAnalyzer.join(
            List.of(new ShownAgg("Watercolor", 10, 1.0)), List.of(new ReflectAgg("watercolor", 5)));
    assertThat(rows).hasSize(1);
    ChipRow r = rows.get(0);
    assertThat(r.shown()).isEqualTo(10);
    assertThat(r.reflect()).isEqualTo(5);
    assertThat(r.reflectRate()).isEqualTo(0.5);
    assertThat(r.unmeasured()).isFalse();
  }

  @Test
  @DisplayName("정렬_노출크고_반영적은_칩이_위로_안감")
  void sortsByConversionRateNotAbsoluteReflect() {
    // A: 노출 100, 반영 10 → 전환율 0.10 (절대 반영수 10)
    // B: 노출 5,   반영 4  → 전환율 0.80 (절대 반영수 4)
    // 절대 반영수로는 A>B 지만, 전환율 정렬은 B 가 위여야 한다.
    List<ChipRow> rows =
        ChipAnalyzer.join(
            List.of(new ShownAgg("A", 100, 0), new ShownAgg("B", 5, 0)),
            List.of(new ReflectAgg("A", 10), new ReflectAgg("B", 4)));
    assertThat(rows).extracting(ChipRow::label).containsExactly("B", "A");
  }

  @Test
  @DisplayName("노출0_라벨은_미기록_전환율null_맨뒤")
  void unmeasuredLabelSortsLastWithNullRate() {
    List<ChipRow> rows =
        ChipAnalyzer.join(
            List.of(new ShownAgg("x", 10, 0)),
            List.of(new ReflectAgg("x", 2), new ReflectAgg("y", 5)));
    ChipRow last = rows.get(rows.size() - 1);
    assertThat(last.label()).isEqualTo("y");
    assertThat(last.reflectRate()).isNull();
    assertThat(last.unmeasured()).isTrue();
    // x 는 정상 전환율
    assertThat(rows.get(0).label()).isEqualTo("x");
    assertThat(rows.get(0).reflectRate()).isEqualTo(0.2);
  }

  @Test
  @DisplayName("가중_평균_position_대소문자_병합")
  void mergesCaseInsensitiveWithWeightedAvgPosition() {
    // "a"(노출2,pos1.0) + "A"(노출3,pos3.0) → 병합 노출5, 가중평균 (2*1+3*3)/5 = 2.2
    List<ChipRow> rows =
        ChipAnalyzer.join(List.of(new ShownAgg("a", 2, 1.0), new ShownAgg("A", 3, 3.0)), List.of());
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).shown()).isEqualTo(5);
    assertThat(rows.get(0).avgPosition()).isCloseTo(2.2, within(1e-9));
    assertThat(rows.get(0).reflectRate()).isEqualTo(0.0); // 노출 있고 반영 0 → 0%
  }

  @Test
  @DisplayName("빈입력_안전")
  void handlesEmptyAndNullInput() {
    assertThat(ChipAnalyzer.join(List.of(), List.of())).isEmpty();
    assertThat(ChipAnalyzer.join(null, null)).isEmpty();
  }
}
