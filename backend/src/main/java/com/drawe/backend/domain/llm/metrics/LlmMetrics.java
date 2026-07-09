package com.drawe.backend.domain.llm.metrics;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * AI 파이프라인 실시간 메트릭(Micrometer) 기록기.
 *
 * <p>기존 {@code analytics_events}(DB, 사후 SQL 분석) 와 보완 관계 — 이쪽은 prometheus 스크랩용 실시간 메트릭이다. 비즈니스 로직에
 * {@link MeterRegistry} 를 흩뿌리지 않도록 측정 지점을 이 얇은 래퍼에 모은다. 설계: {@code
 * docs/decisions/S1-micrometer-design.md} (ADR §4 메트릭, §8 도구).
 *
 * <p><b>태그 카디널리티 통제</b>: 고카디널리티 값(userId, sessionId, 원문 메시지)은 절대 태그로 쓰지 않는다. 유한 열거값만 (rule_id,
 * action, provider, outcome). 시계열 폭발·PII 누설 방지.
 */
@Slf4j
@Component
public class LlmMetrics {

  private static final String ROUTE = "drawe.intent.route";
  private static final String RULE = "drawe.intent.rule";
  private static final String CLASSIFY = "drawe.intent.classify";
  private static final String LLM_CALL = "drawe.llm.call";

  // 채팅 LLM(GROK/CLAUDE, Spring Boot) 응답 latency 히스토그램(Grafana P95/P99 용).
  // 이름에 chat 을 박아 FastAPI 가이드 VLM 지연과 구분한다. LLM_CALL(평균·성공률, 버킷 없음)과도 분리.
  private static final String CHAT_LATENCY = "drawe.chat_llm.latency";

  // ⑦ COMPOSE 출력 규격화 DoD 측정(설계 §5.2).
  private static final String STRUCTURE_VIOLATION = "drawe.output.structure_violation";
  private static final String HALLUCINATED_CITATION = "drawe.output.hallucinated_citation";
  private static final String CITATION_REMOVED = "drawe.output.citation_removed";

  private final MeterRegistry registry;

  public LlmMetrics(MeterRegistry registry) {
    this.registry = registry;
  }

  /**
   * 룰 프리라우터가 의도를 결정(LLM 콜 0). coverage 분자.
   *
   * @param ruleId 발화한 룰 id (유한: empty/generate_verb/thanks_greeting/self_critique)
   * @param action 매핑된 Action/의도코드 (NEW_SEARCH/KEEP/SKIP/GENERATE_NOW, 또는 010 등 의도코드)
   */
  public void ruleHit(String ruleId, String action) {
    registry.counter(ROUTE, "outcome", "rule_hit").increment();
    registry.counter(RULE, "rule_id", ruleId, "action", action).increment();
  }

  /** 룰 미스 → Grok 풀 분류 폴백. coverage 분모(분자와 합산). */
  public void ruleMiss() {
    registry.counter(ROUTE, "outcome", "rule_miss").increment();
  }

  /**
   * 경량 분류기(Grok) 호출 latency 기록 — DoD ≤300ms 측정.
   *
   * @param elapsed 분류 호출에 걸린 시간
   * @param success 예외 없이 결과를 받았는지
   */
  public void classifyLatency(Duration elapsed, boolean success) {
    Timer.builder(CLASSIFY)
        .tag("outcome", success ? "success" : "error")
        .register(registry)
        .record(elapsed);
  }

  /**
   * 메인 LLM 호출 latency·성공률.
   *
   * @param provider LLM 공급자 (GROK/CLAUDE/GEMINI)
   * @param elapsed 호출에 걸린 시간
   * @param success 성공 여부
   */
  public void llmCall(String provider, Duration elapsed, boolean success) {
    Timer.builder(LLM_CALL)
        .tag("provider", provider)
        .tag("outcome", success ? "success" : "error")
        .register(registry)
        .record(elapsed);
  }

  /**
   * 채팅 LLM(GROK/CLAUDE, Spring Boot) 응답 latency 를 <b>히스토그램</b> Timer 로 기록 — Grafana P95/P99(AMP
   * {@code histogram_quantile})용. export 이름은 {@code drawe_chat_llm_latency_seconds_*}. FastAPI 가이드
   * VLM 지연과는 무관(별도 슬라이스).
   *
   * <p>{@code chat_success.latency_ms}(analytics_events payload, 사후 SQL 분석)와 <b>동일한 값</b>을 실시간
   * 메트릭으로도 흘려보낸다(중복 OK — payload 는 그대로 유지). {@link #llmCall}(평균·성공률용, 버킷 없음)과 달리 이쪽은 {@code
   * publishPercentileHistogram()} 으로 {@code _seconds_bucket{le}} 시리즈를 발행한다 — 이게 없으면 AMP 에서 분위수 산출이
   * 불가능하다.
   *
   * <p>성공 응답에만 latency 가 존재하므로 {@code outcome="success"} 만 기록한다(실패 경로 payload 엔 latency 없음). 카디널리티
   * 통제: provider(유한 열거)·outcome 만 태그.
   *
   * @param provider LLM 공급자 (GROK/CLAUDE/GEMINI)
   * @param elapsed 채팅 응답 latency (provider 내부 측정치)
   */
  public void chatLatency(String provider, Duration elapsed) {
    try {
      Timer.builder(CHAT_LATENCY)
          .tag("provider", provider)
          .tag("outcome", "success")
          .publishPercentileHistogram()
          .register(registry)
          .record(elapsed);
    } catch (RuntimeException e) {
      // 계측 실패가 채팅 응답을 깨선 안 된다 — 메트릭 유실만 허용하고 요청 처리는 계속한다.
      log.debug("chatLatency 기록 실패(무시): error_class={}", e.getClass().getSimpleName());
    }
  }

  /**
   * COMPOSE 응답 구조 위반(설계 §5.2, DoD ≤1%). 분모는 COMPOSE 호출 수 ({@code drawe.workflow.step{step=COMPOSE}}
   * count).
   *
   * @param provider LLM 공급자 (GROK/CLAUDE/GEMINI)
   * @param reason 위반 사유 (유한: {@code json_broke} 깨진 JSON 폴백 | {@code schema_reject} 스키마 거부)
   */
  public void structureViolation(String provider, String reason) {
    registry.counter(STRUCTURE_VIOLATION, "provider", provider, "reason", reason).increment();
  }

  /**
   * 환각 인용 발생(설계 §5.2, DoD <b>0건</b>). 1건이라도 카운트되면 알림 대상. source 별로 분리해 어디서 새는지 본다.
   *
   * @param source 환각 출처 (유한: {@code citations_field} citations 슬롯 범위밖 | {@code body_scan} 본문 [N]
   *     범위밖 | {@code no_refs} 참고 0인데 인용함)
   * @param count 해당 source 의 환각 수. 0 이면 발사하지 않는다.
   */
  public void hallucinatedCitation(String source, int count) {
    if (count <= 0) {
      return;
    }
    registry.counter(HALLUCINATED_CITATION, "source", source).increment(count);
  }

  /**
   * 무결성 검사로 제거된 인용 토큰 수(관측용, 설계 §5.2). citations 슬롯 + 본문 합산.
   *
   * @param count 제거된 총수. 0 이면 발사하지 않는다.
   */
  public void citationRemoved(int count) {
    if (count <= 0) {
      return;
    }
    registry.counter(CITATION_REMOVED).increment(count);
  }
}
