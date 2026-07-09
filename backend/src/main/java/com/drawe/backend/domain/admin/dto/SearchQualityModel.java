package com.drawe.backend.domain.admin.dto;

/**
 * 검색 품질 탭 모델.
 *
 * <p>Kpi/Backlog/Demand는 {@code search_logs} 집계(키워드 기준). <b>Friction(검색 마찰)</b>은 {@code
 * analytics_events} 세션 시퀀스 집계 — "검색이 *쉽게 끝났나*"를 본다(재검색/루프/차단 후 멈춤).
 *
 * <p>PII 원칙: {@code original_message}는 어디서도 조회/표시하지 않는다 — 키워드 그룹 집계만.
 *
 * <p>Backlog/Demand는 {@link AdminPage}로 감싸 페이지네이션·검색 상태를 같이 들고 다닌다.
 */
public final class SearchQualityModel {

  private SearchQualityModel() {}

  /** 상단 요약 지표. 비율/평균은 데이터 없으면 null → 화면 "—". */
  public record Kpi(
      int windowHours,
      String generatedAtText,
      long totalSearches,
      long blockedSearches, // result_count=0 OR avg_score<0.2
      Double blockRate, // 0.0~1.0
      Double successRate, // 1 - blockRate (검색 성공률, KO 헤드라인). blockRate null이면 null
      Double avgResultCount,
      Double avgScore) {

    /** KO 헤드라인 표기 — total 0이면 "—". */
    public String successRateText() {
      return successRate == null
          ? "—"
          : String.format(java.util.Locale.US, "%.1f%%", successRate * 100);
    }
  }

  /** 검색어 어절 랭킹 한 줄 — extracted_keywords를 어절로 쪼갠 빈도(형태소 분석 아님, 규칙 기반 근사). */
  public record WordRank(String word, long count) {}

  /**
   * 검색 마찰 — 세션 기준(analytics_events). "검색을 했는데 바로 성공 못 하고 겪는 과정".
   *
   * <p>'이탈(abandon)'은 클릭 이벤트가 없어 "검색·차단이 세션의 *마지막* 이벤트"로 근사한다. 베타 표본이 작으면 대부분 0.
   *
   * @param searchSessions 검색(실행/차단)을 1회 이상 한 세션
   * @param researchSessions 검색을 2회 이상 한 세션 (= 재검색)
   * @param researchRate researchSessions / searchSessions (null=검색 세션 없음)
   * @param loopSessions 검색 3회+ 그리고 성공(chat_success) 0 인 세션 (UX/데이터 mismatch 신호)
   * @param blockedSessions 차단(search_blocked)을 겪은 세션
   * @param abandonAfterBlock 세션의 마지막 이벤트가 차단인 세션 (= 차단 후 멈춤, 근사)
   * @param abandonRate abandonAfterBlock / blockedSessions (null=차단 세션 없음)
   */
  public record Friction(
      long searchSessions,
      long researchSessions,
      Double researchRate,
      long loopSessions,
      long blockedSessions,
      long abandonAfterBlock,
      Double abandonRate) {}

  /** 시드 보강 백로그 한 줄 — 결과가 부족했던 검색을 키워드별로. */
  public record BacklogRow(String keyword, long count, Double avgScore, String lastAtText) {}

  /**
   * 검색 수요 TOP 한 줄 — 전체 키워드 빈도 + 품질.
   *
   * @param inBacklog 현재 백로그 페이지에도 등장(고수요이면서 저품질) → 강조 배지용
   */
  public record DemandRow(
      String keyword,
      long count,
      Double avgResultCount,
      Double avgScore,
      long blockedCount,
      boolean inBacklog) {}

  /**
   * 화면에 한 번에 넘기는 묶음. backlog/demand 는 페이지 객체.
   *
   * @param wordTopAll 검색어 어절 TOP(전체 기준)
   * @param wordTopLowQuality 검색어 어절 TOP(저품질 기준)
   */
  public record View(
      Kpi kpi,
      Friction friction,
      AdminPage<BacklogRow> backlog,
      AdminPage<DemandRow> demand,
      java.util.List<WordRank> wordTopAll,
      java.util.List<WordRank> wordTopLowQuality) {}
}
