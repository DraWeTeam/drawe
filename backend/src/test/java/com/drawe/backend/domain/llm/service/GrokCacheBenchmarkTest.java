package com.drawe.backend.domain.llm.service;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import com.drawe.backend.domain.enums.MessageRole;
import com.drawe.backend.domain.llm.dto.LlmCallContext;
import com.drawe.backend.domain.llm.dto.LlmCallResult;
import com.drawe.backend.global.config.LlmProperties;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/**
 * Grok 프롬프트 캐시 ↔ history trim 전략 격리 벤치마크.
 *
 * <p>목적: MySQL·Redis·fastapi·로그인 없이 {@link GrokService#generate} 만 직접 호출해, 멀티턴에서 {@code
 * x-grok-conv-id} 캐시 적중(usage.prompt_tokens_details.cached_tokens)이 history trim 방식에 따라 어떻게 달라지는지
 * 통제된 환경에서 비교한다.
 *
 * <p>세 전략을 같은 시나리오로 돌린다:
 *
 * <ul>
 *   <li><b>APPEND_ONLY</b> — 앞을 안 자름(이상적). SYSTEM+이전 턴이 그대로 누적 → prefix 안정 → 캐시 누적 적중.
 *   <li><b>SLIDING</b> — 현재 {@code TokenAwareHistoryTrimmer} 방식. 매 턴 오래된 턴을 잘라 윈도우를 1턴씩 민다 → 매 턴
 *       prefix 가 흔들려 캐시가 SYSTEM floor 로 무너진다.
 *   <li><b>CHUNK</b> — 제안 방식. 상한 초과 시에만 하한까지 덩어리로 잘라, 그 사이 여러 턴 동안 prefix 고정 → 캐시 유지.
 * </ul>
 *
 * <p><b>실행</b>: IDE 에서 ▶ Run 하거나 {@code ./gradlew test --tests "*GrokCacheBenchmarkTest"}. Grok
 * 키·모델·baseUrl 은 클래스패스의 {@code application-llm.properties}(로컬 시크릿)에서 자동으로 읽는다 — env 불필요. 없으면(CI 등)
 * env 폴백 → 그래도 없으면 {@code assumeTrue} 로 skip.
 *
 * <p>출력 {@code TOKENCOST provider=GROK ... cached=N} 줄(IDE 콘솔 / {@code build/reports/tests/test} /
 * {@code build/test-results/test/*.xml} system-out). 각 호출 직전에 {@code -- <전략> turn N --} 헤더를 찍어 귀속
 * 가능. 실비용은 usage 의 {@code cost_in_usd_ticks}(xAI 가 캐시 할인까지 반영한 실청구액)로 비교한다.
 */
class GrokCacheBenchmarkTest {

  /** 현실적 크기의 고정 SYSTEM prefix — 캐시 대상이 될 만큼 길고, 매 턴 바이트 동일해야 한다. */
  private static final String SYSTEM_PROMPT =
      """
      [페르소나]
      너는 그림 초보자를 돕는 따뜻한 미술 코치다. 사용자의 그림 작업을 격려하며,
      구체적이고 실천 가능한 조언을 한국어로 제공한다. 전문 용어는 쉽게 풀어 설명하고,
      사용자가 막막해하지 않도록 다음 한 걸음을 분명히 제시한다.

      [사용자 선호]
      - 기법: 수채화, 펜드로잉
      - 주제: 풍경, 정물
      - 분위기: 잔잔함, 따뜻함

      [프로젝트 정보]
      - 이름: 가을 풍경 연습
      - 주제: 풍경
      - 스타일: 수채화
      - 분위기: 잔잔함

      [응답 가이드]
      - 한두 문단으로 간결하게.
      - 사용자가 바로 시도할 수 있는 구체적 방법을 1~2개 제시.
      - 과장하거나 하지 않은 일을 한 척하지 말 것.
      """;

  /** 6라운드 멀티턴 — trim 이 실제로 발동할 만큼 길게. */
  private static final List<String> USER_TURNS =
      List.of(
          "수채화로 잔잔한 가을 풍경을 그리고 싶은데 어디서부터 시작하면 좋을까?",
          "방금 말한 색감 부분을 좀 더 자세히 알려줄래?",
          "번지기 기법은 어떻게 연습하는 게 좋아?",
          "하늘이랑 산 경계는 어떻게 자연스럽게 풀어?",
          "물 양 조절이 자꾸 실패하는데 팁 있어?",
          "마지막으로 전체 구도를 잡는 순서를 정리해줘.");

  /** 이번 턴에 보낼 이전 턴(user/assistant) 부분집합을 고르는 전략. SYSTEM·새 user 메시지는 호출부가 붙인다. */
  @FunctionalInterface
  interface HistorySelector {
    List<LlmCallContext.Turn> select(List<LlmCallContext.Turn> prior, int turnIndex);
  }

  private static String apiKey;
  private static String model;
  private static String baseUrl;

  @BeforeAll
  static void setup() {
    Properties p = new Properties();
    try (InputStream in =
        GrokCacheBenchmarkTest.class
            .getClassLoader()
            .getResourceAsStream("application-llm.properties")) {
      if (in != null) {
        p.load(in);
      }
    } catch (Exception ignored) {
      // best-effort — 파일 없으면 env 폴백
    }
    apiKey = firstNonBlank(p.getProperty("llm.grok.api-key"), System.getenv("GROK_API_KEY"));
    model = firstNonBlank(p.getProperty("llm.grok.model"), System.getenv("GROK_MODEL"));
    baseUrl =
        firstNonBlank(
            p.getProperty("llm.grok.base-url"),
            System.getenv("GROK_BASE_URL"),
            "https://api.x.ai/v1");
    ((Logger) LoggerFactory.getLogger(GrokService.class)).setLevel(Level.DEBUG);
  }

  @Test
  void compareTrimStrategies() {
    Assumptions.assumeTrue(apiKey != null && !apiKey.isBlank(), "GROK_API_KEY 미설정 — skip");
    Assumptions.assumeTrue(model != null && !model.isBlank(), "GROK_MODEL 미설정 — skip");

    LlmProperties props = new LlmProperties();
    props.getGrok().setApiKey(apiKey);
    props.getGrok().setModel(model);
    props.getGrok().setBaseUrl(baseUrl);
    GrokService grok = new GrokService(props);

    // 시나리오마다 cold-start 보장 위해 run 마다 고유 conv-id 접두어(이전 run 의 warm 캐시 오염 방지).
    String runId = Long.toHexString(System.nanoTime());

    // 0) BASELINE: conv-id OFF(헤더 없음 = 도입 전). history 는 append 로 고정해 conv-id 효과만 격리.
    //    같은 append 인데 conv-id 만 빼면 캐시 적중이 어떻게 달라지는지 = OFF→ON 전후. (null → GrokService 가 헤더 미부착)
    runScenario(grok, "NO_CONVID(append)", null, (prior, i) -> prior);

    // 1) APPEND_ONLY (conv-id ON) — 앞 고정, 전부 누적.
    runScenario(grok, "APPEND(conv-id ON)", runId + "-append", (prior, i) -> prior);

    // 2) SLIDING — 최근 1라운드(2턴)만. 현재 TokenAwareHistoryTrimmer 의 tail-trim 을 단순화한 형태.
    runScenario(
        grok,
        "SLIDING",
        runId + "-sliding",
        (prior, i) -> prior.subList(Math.max(0, prior.size() - 2), prior.size()));

    // 3) CHUNK — 상한(4턴) 초과 시에만 하한(2턴)까지 덩어리로 절단. 그 사이엔 prefix 고정.
    int[] dropped = {0};
    runScenario(
        grok,
        "CHUNK",
        runId + "-chunk",
        (prior, i) -> {
          int high = 4;
          int low = 2;
          if (prior.size() - dropped[0] > high) {
            dropped[0] = prior.size() - low;
          }
          return prior.subList(Math.min(dropped[0], prior.size()), prior.size());
        });

    System.out.printf(
        "%n전략별 'TOKENCOST provider=GROK' 줄의 cached / cost_in_usd_ticks 를 비교하세요.%n"
            + "APPEND/CHUNK 은 cached 가 누적 상승, SLIDING 은 SYSTEM floor 로 정체되면 가설 확인.%n");
  }

  /** 한 전략으로 USER_TURNS 를 끝까지 돌린다. 각 호출 직전 헤더를 찍어 TOKENCOST 줄을 귀속 가능하게. */
  private void runScenario(
      GrokService grok, String label, String convId, HistorySelector selector) {
    System.out.printf("%n########## 시나리오: %s (conv-id=%s) ##########%n", label, convId);
    List<LlmCallContext.Turn> transcript = new ArrayList<>(); // user/assistant 누적
    for (int i = 0; i < USER_TURNS.size(); i++) {
      String userMessage = USER_TURNS.get(i);
      List<LlmCallContext.Turn> selected = selector.select(transcript, i);

      List<LlmCallContext.Turn> history = new ArrayList<>();
      history.add(new LlmCallContext.Turn(MessageRole.SYSTEM, SYSTEM_PROMPT));
      history.addAll(selected);

      LlmCallContext ctx = new LlmCallContext(history, userMessage, null, null, null, convId);
      System.out.printf("-- %s turn %d (보낸 히스토리 턴수=%d) --%n", label, i + 1, selected.size());
      LlmCallResult result = grok.generate(ctx);

      transcript.add(new LlmCallContext.Turn(MessageRole.USER, userMessage));
      transcript.add(new LlmCallContext.Turn(MessageRole.ASSISTANT, result.content()));
    }
  }

  /** 첫 번째 non-blank 값 반환(없으면 null). */
  private static String firstNonBlank(String... values) {
    for (String v : values) {
      if (v != null && !v.isBlank()) {
        return v;
      }
    }
    return null;
  }
}
