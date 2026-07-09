package com.drawe.backend.domain.admin.dto;

import java.util.List;
import java.util.Locale;

/**
 * 어드민 "칩 분석" 탭 뷰모델 — AI 추천 키워드 칩의 노출→반영 전환율(추천 품질).
 *
 * <p>노출 = {@code chip_shown} 이벤트(WP6-a),
 * 반영 = {@code projects.keywords}(JSON). 라벨 정규화(lowercase·trim)로
 * 조인한다. <b>정렬은 노출 보정 전환율</b>(반영/노출) — 많이 추천된 칩이 무조건 위로 가지 않게(어절 랭킹과 같은 함정 방지).
 *
 * <p>⚠️ {@code chip_shown} 계측은 최근(WP6-a) 시작이라 노출 데이터가 얇을 수 있다. 노출 0인데 반영만 있는 라벨(계측 전 프로젝트)은 전환율
 * "—"(노출 미기록)로 구분한다 — 100%/0% 로 오해하지 않게.
 */
public record ChipModel() {

  public record View(
      String generatedAtText,
      Double koReflectRate, // 전체 반영합/노출합. 노출 0이면 null
      String koReliability, // green | yellow(표본 얇음)
      long totalShown,
      long totalReflect,
      boolean lowData, // 노출 표본이 얇아 해석 주의
      List<ChipRow> rows) {

    public String koReflectText() {
      return koReflectRate == null
          ? "—"
          : String.format(Locale.US, "%.0f%%", koReflectRate * 100);
    }
  }

  /**
   * 칩 라벨 하나의 노출/반영 집계.
   *
   * @param label 표시용 라벨(정규화 전 원본 대표값)
   * @param reflectRate 반영/노출. 노출 0이면 null("—")
   * @param unmeasured 노출 미기록(노출 0, 반영만 있음)
   */
  public record ChipRow(
      String label,
      long shown,
      long reflect,
      Double reflectRate,
      Double avgPosition,
      boolean unmeasured) {

    public String reflectText() {
      return reflectRate == null ? "—" : String.format(Locale.US, "%.0f%%", reflectRate * 100);
    }

    public String avgPositionText() {
      return avgPosition == null ? "—" : String.format(Locale.US, "%.1f", avgPosition);
    }
  }
}
