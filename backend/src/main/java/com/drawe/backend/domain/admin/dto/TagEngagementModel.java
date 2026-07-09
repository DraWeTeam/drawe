package com.drawe.backend.domain.admin.dto;

import java.util.List;

/**
 * 어드민 "태그별 레퍼런스 관심도" 탭 뷰모델.
 *
 * <p>한 이미지는 technique·subject·mood 세 축의 태그를 동시에 가지므로, 축별로 따로 롤업한다.
 *
 * <p>신호 출처: shown(노출)=references_json, likes=image_feedback, pins=project_references(프로젝트 저장),
 * clicks=GA4. <b>약신호 페이지</b>라 화면 최상단 게이트로 신뢰도를 먼저 판정한 뒤 순위를 본다.
 *
 * <p><b>정렬 = 노출 보정 전환율</b>(clicks+likes+pins)/shown. 절대 점수(engagementScore)는 tiebreak 로 강등 — 많이 보여준
 * 태그가 무조건 위로 가지 않게.
 */
public record TagEngagementModel() {

  public record View(
      String generatedAtText,
      boolean clicksAvailable,
      Gate gate,
      Double koConversionRate, // 전체 (클릭+좋아요+핀)/노출, 노출 0이면 null
      String koReliability, // 게이트 따라감: green|yellow
      double maxAxisShare, // 전 축 중 최대 노출 점유율(Guardrail)
      String maxShareAxis, // 그 축 이름
      boolean skewWarn, // maxAxisShare > 0.5
      List<AxisRollup> axes,
      List<CandidateRow> supplyGapCandidates, // 후보 A
      Hygiene hygiene) { // 후보 B + 진단

    public String koConversionText() {
      return koConversionRate == null
          ? "—"
          : String.format(java.util.Locale.US, "%.1f%%", koConversionRate * 100);
    }

    public String maxAxisShareText() {
      return String.format(java.util.Locale.US, "%.0f%%", maxAxisShare * 100);
    }
  }

  /** 🚦 신호 신뢰도 게이트 판정. */
  public record Gate(String level, String coverageText, String reasonText) {
    public boolean warn() {
      return !"green".equals(level);
    }
  }

  /** 한 축(technique/subject/mood)의 태그별 집계. rows 는 전환율 내림차순 정렬됨. */
  public record AxisRollup(String axis, List<TagRow> rows, Double maxShare, String topTag) {}

  /** 태그 값 하나의 집계치. */
  public record TagRow(
      String value,
      long images,
      long shown,
      long clicks,
      long likes,
      long pins,
      Double ctr, // clicks/shown
      Double conversionRate) { // (clicks+likes+pins)/shown — 주 정렬키

    public String conversionText() {
      return conversionRate == null
          ? "—"
          : String.format(java.util.Locale.US, "%.1f%%", conversionRate * 100);
    }
  }

  /** ⭐ 공급-관심 갭 후보(사분면). kind = "공급 부족"(전환율↑·노출↓) | "과공급"(노출↑·전환율↓). */
  public record CandidateRow(
      String axis, String tag, Double conversionRate, long shown, String kind) {
    public String conversionText() {
      return conversionRate == null
          ? "—"
          : String.format(java.util.Locale.US, "%.1f%%", conversionRate * 100);
    }
  }

  /** 태그 위생 — 표시만(자동 병합·삭제 금지). */
  public record Hygiene(List<String> testLikeTags, List<AliasPair> aliasSuspects) {}

  /** 한영 중복 의심 정적 후보. */
  public record AliasPair(String a, String b) {}
}
