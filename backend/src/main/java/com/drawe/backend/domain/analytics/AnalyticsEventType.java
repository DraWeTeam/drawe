package com.drawe.backend.domain.analytics;

/**
 * Analytics 이벤트 타입 상수.
 *
 * <p>오타 방지 + 추적 가능한 이벤트 목록 명시화. 새 이벤트 추가 시 여기에 상수 먼저 추가.
 */
public final class AnalyticsEventType {

  private AnalyticsEventType() {}

  // ── 채팅 ──────────────────────────────────────────
  /** 새 채팅 세션 시작 (createSessionWithPersona 호출 시). */
  public static final String CHAT_START = "chat_start";

  /** 채팅 응답 성공 완료. payload: latency_ms, response_length, provider. */
  public static final String CHAT_SUCCESS = "chat_success";

  /** 채팅 에러. payload: error_class, error_msg. */
  public static final String CHAT_ERROR = "chat_error";

  // ── 검색 ──────────────────────────────────────────
  /** 검색 실행 (NEW_SEARCH 결정 후). payload: keyword, result_count, avg/max/min score. */
  public static final String SEARCH_EXECUTED = "search_executed";

  /** 검색 결과 무관 판단으로 차단. payload: keyword, avg_score, max_score. */
  public static final String SEARCH_BLOCKED = "search_blocked";

  // ── 보드 검색 ──────────────────────────────────────
  // 채팅 검색(위)과 별개 소스 — 채팅 검색 품질 지표를 오염시키지 않도록 별도 event_type 으로 집계한다.
  /** 무드보드 검색 실행(결과 반환). payload: keyword, result_count, avg_score, max_score. */
  public static final String BOARD_SEARCH_EXECUTED = "board_search_executed";

  /** 무드보드 검색 결과 무관 판단으로 차단(→ 생성 유도). payload: keyword, result_count, avg_score, max_score. */
  public static final String BOARD_SEARCH_BLOCKED = "board_search_blocked";

  /** 키워드 추출 결정: 이전 references 유지. */
  public static final String DECISION_KEEP = "decision_keep";

  /** 키워드 추출 결정: 검색 불필요. */
  public static final String DECISION_SKIP = "decision_skip";

  /** 키워드 추출 결정: 직전 답변에 대한 부연·후속 질문 (012 FOLLOWUP). 검색 없이 직전 답변을 이어서 설명. */
  public static final String DECISION_FOLLOWUP = "decision_followup";

  /** 키워드 추출 결정: 이미 맥락에 있는 대상 비교 (013 COMPARE). 검색·생성 없이 비교·대조 설명. */
  public static final String DECISION_COMPARE = "decision_compare";

  // ── 이미지 생성 ────────────────────────────────────
  /**
   * AI 이미지 생성(Bria 호출) 1건 완료. payload: prompt_length, image_id.
   *
   * <p>{@code images} 테이블엔 created_at 컬럼이 없어 일별/윈도우 집계가 불가능하므로, 생성 시점을 analytics_events 로 남겨 어드민
   * Cost 탭에서 일별 Bria 호출 수를 센다. 원문 프롬프트는 PII라 길이만.
   */
  public static final String IMAGE_GENERATED = "image_generated";

  // ── 온보딩 ────────────────────────────────────────
  /** 온보딩 완료. payload: selected_count, saved_pref_count. */
  public static final String ONBOARDING_COMPLETED = "onboarding_completed";

  // ── 키워드 칩 ──────────────────────────────────────
  /**
   * AI(Grok) 추천 키워드 칩 노출. 프로젝트 생성 1단계 {@code POST /projects/keyword-extraction} 결과가 사용자에게 보여지는 시점에
   * 백엔드가 발화한다.
   *
   * <p>payload: {@code source="ai_keyword"}, {@code chips=[{label,position}]}(원본 라벨 보존 — 집계 때 정규화),
   * {@code chip_count}, {@code topic_len}. 반영(최종 채택)은 {@code projects.keywords}(JSON)로 별도 저장되므로
   * 이벤트로 다루지 않는다 — 노출→반영 전환은 이 이벤트 + 프로젝트 쿼리로 집계.
   */
  public static final String CHIP_SHOWN = "chip_shown";

  // ── 가이드 ────────────────────────────────────────
  /** LLM 가이드 응답 완성 (chat_success와 같이 발송, 가이드 품질 분석용). */
  public static final String GUIDE_COMPLETED = "guide_completed";

  /**
   * 이미지 가이딩 생성 결과 1건. {@code GuideService.guide()} 신규 생성 시 백엔드가 모든 mode 에 대해 발화(멱등 재사용은 스킵).
   * 성공률(coach 비율) 산출용 — {@code guides} 테이블은 coach 만 저장해 refused/clarify/redirect 를 못 보므로 이벤트로 남긴다.
   *
   * <p>payload: {@code mode}(coach|refused|clarify|redirect), {@code degraded}(bool), {@code
   * primary_focus}(nullable).
   *
   * <p>⚠️ 프론트가 GA4(dataLayer)로 쏘는 {@code guide_generated} 와는 <b>별개</b>다 — 저장소(백엔드
   * analytics_events)와 목적(성공률)이 다르다. 이름 충돌을 피하려고 {@code guide_result} 로 명명.
   */
  public static final String GUIDE_RESULT = "guide_result";

  /**
   * 이미지 가이딩 레퍼런스 재추천(🔄) 요청 1건. {@code GuideService.rerollReferences()} 진입 시 발화(결과 성공/고갈/생성중 무관 —
   * '재추천 시도' 자체가 불만족 신호). payload: {@code guide_id}, {@code sub_problem}.
   */
  public static final String GUIDE_REROLL = "guide_reroll";

  // ── 의도 분류 (S1' 트랙 A 룰 프리라우터) ───────────
  /**
   * 룰 프리라우터가 LLM 콜 없이 의도를 결정. payload: rule_id, action.
   *
   * <p>룰 적중률(ADR §4 DoD ≥ 30%) = RULE_HIT / (RULE_HIT + RULE_MISS).
   */
  public static final String INTENT_RULE_HIT = "intent_rule_hit";

  /** 룰 미스 → Grok 풀 분류로 폴백. payload: message_length. */
  public static final String INTENT_RULE_MISS = "intent_rule_miss";

  // ── 사용자 피드백 (채팅 N턴 후 자유서술) ─────────────
  /**
   * N턴 도달로 피드백 인라인 카드 노출. 프론트가 발송. payload: turn_count.
   *
   * <p>깔때기 시작점 — TRIGGERED 대비 OPENED/SUBMITTED 전환율로 카드 노출 지점(N)의 적정성을 본다.
   */
  public static final String FEEDBACK_MODAL_TRIGGERED = "feedback_modal_triggered";

  /** 인라인 카드 클릭으로 모달 오픈. 프론트가 발송. payload: turn_count. */
  public static final String FEEDBACK_MODAL_OPENED = "feedback_modal_opened";

  /**
   * 피드백 제출 완료. POST /feedback 커밋 시 백엔드가 발송. payload: turn_count, body_length.
   *
   * <p>원문(body)은 PII라 로그·payload 엔 길이만 남기고, 전문은 user_feedback 테이블에만 저장한다.
   */
  public static final String FEEDBACK_SUBMITTED = "feedback_submitted";
}
