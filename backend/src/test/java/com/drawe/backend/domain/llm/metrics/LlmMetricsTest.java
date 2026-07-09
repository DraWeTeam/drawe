package com.drawe.backend.domain.llm.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import io.micrometer.prometheus.PrometheusConfig;
import io.micrometer.prometheus.PrometheusMeterRegistry;
import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link LlmMetrics} 단위 테스트. SimpleMeterRegistry 로 카운터/타이머 증가·태그를 검증한다 (Spring 컨텍스트 불필요). 설계:
 * {@code docs/decisions/S1-micrometer-design.md}.
 */
class LlmMetricsTest {

  private SimpleMeterRegistry registry;
  private LlmMetrics metrics;

  @BeforeEach
  void setUp() {
    registry = new SimpleMeterRegistry();
    metrics = new LlmMetrics(registry);
  }

  @Test
  @DisplayName("ruleHit — route(rule_hit) + rule(rule_id,action) 카운터 동시 증가")
  void ruleHit() {
    metrics.ruleHit("generate_verb", "GENERATE_NOW");

    Counter route = registry.find("drawe.intent.route").tag("outcome", "rule_hit").counter();
    Counter rule =
        registry
            .find("drawe.intent.rule")
            .tag("rule_id", "generate_verb")
            .tag("action", "GENERATE_NOW")
            .counter();

    assertThat(route).isNotNull();
    assertThat(route.count()).isEqualTo(1.0);
    assertThat(rule).isNotNull();
    assertThat(rule.count()).isEqualTo(1.0);
  }

  @Test
  @DisplayName("ruleMiss — route(rule_miss) 카운터 증가, rule 카운터는 안 생김")
  void ruleMiss() {
    metrics.ruleMiss();

    Counter miss = registry.find("drawe.intent.route").tag("outcome", "rule_miss").counter();
    assertThat(miss).isNotNull();
    assertThat(miss.count()).isEqualTo(1.0);
    assertThat(registry.find("drawe.intent.rule").counter()).isNull();
  }

  @Test
  @DisplayName("coverage 분모/분자 — hit 2 + miss 1 이면 route 카운터 합 3")
  void coverageCounts() {
    metrics.ruleHit("thanks_greeting", "SKIP");
    metrics.ruleHit("generate_verb", "GENERATE_NOW");
    metrics.ruleMiss();

    double hits = registry.find("drawe.intent.route").tag("outcome", "rule_hit").counter().count();
    double misses =
        registry.find("drawe.intent.route").tag("outcome", "rule_miss").counter().count();
    assertThat(hits).isEqualTo(2.0);
    assertThat(misses).isEqualTo(1.0);
    // coverage = hits/(hits+misses) = 2/3
    assertThat(hits / (hits + misses)).isEqualTo(2.0 / 3.0);
  }

  @Test
  @DisplayName("classifyLatency — Timer 가 outcome 태그로 기록")
  void classifyLatency() {
    metrics.classifyLatency(Duration.ofMillis(250), true);

    Timer timer = registry.find("drawe.intent.classify").tag("outcome", "success").timer();
    assertThat(timer).isNotNull();
    assertThat(timer.count()).isEqualTo(1L);
    assertThat(timer.totalTime(java.util.concurrent.TimeUnit.MILLISECONDS)).isEqualTo(250.0);
  }

  @Test
  @DisplayName("llmCall — provider+outcome 태그로 Timer 기록, 성공/실패 분리")
  void llmCall() {
    metrics.llmCall("GROK", Duration.ofMillis(1200), true);
    metrics.llmCall("GROK", Duration.ofMillis(50), false);

    Timer success =
        registry.find("drawe.llm.call").tag("provider", "GROK").tag("outcome", "success").timer();
    Timer error =
        registry.find("drawe.llm.call").tag("provider", "GROK").tag("outcome", "error").timer();

    assertThat(success.count()).isEqualTo(1L);
    assertThat(error.count()).isEqualTo(1L);
  }

  @Test
  @DisplayName("chatLatency — provider+outcome(success) 태그로 Timer 기록")
  void chatLatency() {
    metrics.chatLatency("CLAUDE", Duration.ofMillis(1800));

    Timer timer =
        registry
            .find("drawe.chat_llm.latency")
            .tag("provider", "CLAUDE")
            .tag("outcome", "success")
            .timer();

    assertThat(timer).isNotNull();
    assertThat(timer.count()).isEqualTo(1L);
    assertThat(timer.totalTime(java.util.concurrent.TimeUnit.MILLISECONDS)).isEqualTo(1800.0);
  }

  @Test
  @DisplayName("chatLatency — Prometheus 스크랩에 _bucket{le} 히스토그램 발행(P95 가능 조건)")
  void chatLatencyPublishesHistogramBuckets() {
    // publishPercentileHistogram 검증은 실제 PrometheusMeterRegistry 스크랩 출력으로만 가능하다
    // (SimpleMeterRegistry 는 le 버킷을 노출하지 않음). _bucket 이 여러 le 로 나와야 histogram_quantile 가능.
    PrometheusMeterRegistry prom = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
    LlmMetrics promMetrics = new LlmMetrics(prom);

    promMetrics.chatLatency("GROK", Duration.ofMillis(1200));
    promMetrics.chatLatency("GROK", Duration.ofMillis(800));

    String scrape = prom.scrape();

    // count/sum 시계열 존재
    assertThat(scrape).contains("drawe_chat_llm_latency_seconds_count");
    assertThat(scrape).contains("drawe_chat_llm_latency_seconds_sum");
    // 태그 노출
    assertThat(scrape).contains("provider=\"GROK\"");
    assertThat(scrape).contains("outcome=\"success\"");
    // ⚠️ 핵심: le 버킷 시리즈가 2개 이상 나와야 분위수 산출 가능
    int bucketLines = countOccurrences(scrape, "drawe_chat_llm_latency_seconds_bucket");
    assertThat(bucketLines).isGreaterThan(1);
  }

  private static int countOccurrences(String haystack, String needle) {
    int count = 0;
    int idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) != -1) {
      count++;
      idx += needle.length();
    }
    return count;
  }
}
