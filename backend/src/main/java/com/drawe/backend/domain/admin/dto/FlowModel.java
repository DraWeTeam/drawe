package com.drawe.backend.domain.admin.dto;

import java.util.List;
import java.util.Locale;

/**
 * 이용 흐름 — {@code analytics_events}를 session_id로 묶어 단계별 *세션 도달*을 본다.
 *
 * <p>각 단계는 "해당 이벤트를 한 번이라도 일으킨 세션 수"(엄밀한 순차 경로가 아니라 도달 기준). reachRate는 전체 세션 대비. 저장/좋아요는
 * session_id가 없어 이 퍼널엔 포함하지 않음(그건 Funnel 탭).
 */
public final class FlowModel {

  private FlowModel() {}

  /** 퍼널 한 단계. reachRate·barPct는 전체 세션 대비(0~100). */
  public record Stage(String label, long sessions, Double reachRate, int barPct) {}

  public record View(
      int windowHours,
      String generatedAtText,
      long totalSessions,
      List<Stage> stages,
      long blockedSessions, // search_blocked 발생 세션
      long erroredSessions, // chat_error 발생 세션
      long onboardedSessions,
      Double succeededReach) { // '응답 성공' 도달율(0~100, KO 헤드라인용). 분모(전체 세션) 0이면 null

    /** KO 헤드라인 표기 — 분모 0이면 "—". */
    public String succeededReachText() {
      return succeededReach == null ? "—" : String.format(Locale.US, "%.1f%%", succeededReach);
    }
  }
}
