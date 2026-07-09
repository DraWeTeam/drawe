package com.drawe.backend.domain.admin.dto;

import java.util.List;
import java.util.Locale;

/**
 * 어드민 "가이딩" 탭 뷰모델 — 서비스 핵심 기능(이미지 기반 한 끗 가이드)의 품질.
 *
 * <p>데이터는 전부 어드민 DB({@code drawe_db})에 이미 쌓인 것만 쓴다(계측 추가 없음): {@code guides}(coach 가이드 1건=1행) +
 * {@code guide_feedback}(가이드 전체 👍/👎). refused/clarify/redirect(생성 성공률)·reroll(불만족)·레퍼런스 소비(adoption_log)는
 * 이 범위 밖 — WP8-b(계측) 및 백로그.
 *
 * <p>🎯 KO = 가이드 만족도(좋아요율). 🛡️ Guardrail = 품질 저하(degraded) 비율. 순수 계산은 {@link
 * com.drawe.backend.domain.admin.service.GuideQualityAnalyzer} 에 위임(테스트 용이).
 */
public record GuideModel() {

  public record View(
      String generatedAtText,
      long guideCount, // 윈도우 내 coach 가이드 생성 수
      long likeCount,
      long dislikeCount,
      Double satisfactionRate, // 좋아요/(좋아요+싫어요). 피드백 0이면 null
      String satisfactionReliability, // none | yellow | green (피드백 표본 기준)
      String satisfactionTone, // good | bad | muted (임계 기준)
      long degradedCount,
      Double degradedRate, // degraded/전체. 가이드 0이면 null
      String degradedReliability, // none | green
      String degradedTone, // good | bad | muted
      boolean lowData, // 피드백 표본이 얇아 만족도 해석 주의
      List<FocusRow> focusRows,
      List<DailyRow> dailyRows,
      List<TaskRow> taskRows) {

    public long feedbackTotal() {
      return likeCount + dislikeCount;
    }

    public String satisfactionText() {
      return satisfactionRate == null
          ? "—"
          : String.format(Locale.US, "%.0f%%", satisfactionRate * 100);
    }

    public String degradedText() {
      return degradedRate == null ? "—" : String.format(Locale.US, "%.0f%%", degradedRate * 100);
    }
  }

  /**
   * 축(primary_focus) 분포 한 줄.
   *
   * @param label 축 id(primary_focus). null 은 '(미분류)'
   * @param count 그 축을 다룬 가이드 수
   * @param share 전체 대비 비율(0~1). 전체 0이면 null
   */
  public record FocusRow(String label, long count, Double share) {
    public String shareText() {
      return share == null ? "—" : String.format(Locale.US, "%.0f%%", share * 100);
    }
  }

  /** 일별 가이드 생성 수(KST). JS 차트가 {day, count} 로 읽는다. */
  public record DailyRow(String day, long count) {}

  /** 가이드당 과제(블록) 수 분포. tasks = 블록 개수, count = 그런 가이드 수. */
  public record TaskRow(int tasks, long count) {}
}
