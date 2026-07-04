package com.drawe.backend.domain.llm.context;

import com.drawe.backend.domain.enums.MessageRole;
import com.drawe.backend.domain.llm.dto.LlmCallContext;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 토큰 예산 기반 history trim.
 *
 * <p>S2' Phase 6 Layer 1. 기존 개수 기반 {@code trimHistory(all, maxNonSystem)} 를 대체한다.
 *
 * <p>흐름:
 *
 * <ol>
 *   <li>SYSTEM·USER·ASSISTANT 분리
 *   <li>{@link TopicChangeDetector} 로 주제 전환 감지 (v1 Noop = 항상 false)
 *   <li>SYSTEM 은 등록 순으로 SYSTEM_BUDGET 안에서 포함
 *   <li>USER·ASSISTANT 는 {@link HistorySanitizer} 로 [N] 정제 후 최근부터 역순으로 HISTORY_BUDGET 안에서 포함 (주제 전환
 *       시 1/4 로 더 공격적)
 *   <li>{@code drawe.tokens.input}, {@code drawe.history.trimmed} 메트릭 기록
 * </ol>
 *
 * <p>예시 예산 (기본): SYSTEM 1200 / History 4000 / Current 1500 / Total 8000.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TokenAwareHistoryTrimmer {

  private static final String METRIC_INPUT_TOKENS = "drawe.tokens.input";
  private static final String METRIC_HISTORY_TRIMMED = "drawe.history.trimmed";

  /** 주제 전환 시 history 예산을 1/4 또는 800 토큰 중 작은 값으로 잘라낸다. */
  private static final int TOPIC_CHANGE_BUDGET_DIVISOR = 4;

  private static final int TOPIC_CHANGE_BUDGET_FLOOR = 800;

  /**
   * history 유지 구간을 자를 때 컷 인덱스를 내림(quantize)할 청크 단위(턴 수). sliding(매 턴 컷이 1씩 전진)과 달리, 컷을 이 배수로만 움직여
   * 청크 사이 여러 턴 동안 "유지 구간의 맨 앞 턴"을 고정한다 → prefix 가 안 흔들려 캐시(Grok {@code x-grok-conv-id} / Claude
   * {@code cache_read})가 적중한다. 대가로 예산을 최대 한 청크만큼 초과할 수 있다(캐시·비용 트레이드오프).
   */
  private static final int HISTORY_CHUNK_TURNS = 6;

  private final TokenCounter tokenCounter;
  private final HistorySanitizer historySanitizer;
  private final TopicChangeDetector topicChangeDetector;
  private final TokenBudgetConfig budget;
  private final MeterRegistry meterRegistry;

  private DistributionSummary inputTokens;
  private Counter trimmedCounter;

  @PostConstruct
  public void init() {
    this.inputTokens =
        DistributionSummary.builder(METRIC_INPUT_TOKENS)
            .description("LLM input tokens per request (system + history + current)")
            .baseUnit("tokens")
            .register(meterRegistry);
    this.trimmedCounter =
        Counter.builder(METRIC_HISTORY_TRIMMED)
            .description("Number of turns trimmed from history due to token budget")
            .register(meterRegistry);
  }

  /**
   * Turn 목록을 토큰 예산 안에 맞게 trim.
   *
   * @param allTurns 전체 메시지 (SYSTEM + USER + ASSISTANT 섞임, 시간 오름차순)
   * @param currentMessage 새 user 메시지 (예산 계산·topic 감지용)
   * @return trim 된 Turn 목록 (SYSTEM 먼저, USER·ASSISTANT 최근 순)
   */
  public List<LlmCallContext.Turn> trim(List<LlmCallContext.Turn> allTurns, String currentMessage) {
    if (allTurns == null || allTurns.isEmpty()) {
      return List.of();
    }

    List<LlmCallContext.Turn> systems = new ArrayList<>();
    List<LlmCallContext.Turn> nonSystems = new ArrayList<>();
    for (LlmCallContext.Turn t : allTurns) {
      if (t.role() == MessageRole.SYSTEM) {
        systems.add(t);
      } else {
        nonSystems.add(t);
      }
    }

    String previousUser = lastUserMessage(nonSystems);
    boolean topicChange = topicChangeDetector.isTopicChange(previousUser, currentMessage);

    List<LlmCallContext.Turn> systemTrimmed =
        trimFromHeadToBudget(systems, budget.getSystemBudget());

    int historyBudget =
        topicChange
            ? Math.min(
                budget.getHistoryBudget() / TOPIC_CHANGE_BUDGET_DIVISOR, TOPIC_CHANGE_BUDGET_FLOOR)
            : budget.getHistoryBudget();

    List<LlmCallContext.Turn> sanitized = historySanitizer.sanitize(nonSystems);
    List<LlmCallContext.Turn> historyTrimmed = trimHistoryChunked(sanitized, historyBudget);

    int trimmedCount =
        (systems.size() - systemTrimmed.size()) + (nonSystems.size() - historyTrimmed.size());
    if (trimmedCount > 0) {
      trimmedCounter.increment(trimmedCount);
    }

    List<LlmCallContext.Turn> result = new ArrayList<>(systemTrimmed);
    result.addAll(historyTrimmed);

    int totalTokens = tokenCounter.countTurns(result) + tokenCounter.count(currentMessage);
    inputTokens.record(totalTokens);

    log.debug(
        "trim — system={}/{}, history={}/{}, topicChange={}, totalTokens={}",
        systemTrimmed.size(),
        systems.size(),
        historyTrimmed.size(),
        nonSystems.size(),
        topicChange,
        totalTokens);

    return result;
  }

  /** 앞에서부터 채우면서 예산 안에 들어가는 만큼만 포함 (SYSTEM 용 — 등록 순서 보존). */
  private List<LlmCallContext.Turn> trimFromHeadToBudget(
      List<LlmCallContext.Turn> turns, int tokenBudget) {
    List<LlmCallContext.Turn> result = new ArrayList<>();
    int tokens = 0;
    for (LlmCallContext.Turn turn : turns) {
      int turnTokens = tokenCounter.countTurn(turn);
      if (tokens + turnTokens > tokenBudget) {
        break;
      }
      result.add(turn);
      tokens += turnTokens;
    }
    return result;
  }

  /**
   * 청크 기반 history trim — 기존 매 턴 sliding(컷이 1씩 전진해 prefix 가 깨짐)을 대체한다.
   *
   * <p>① 예산을 만족하는 최소 컷 {@code slidingFrom}(최근부터 역순으로 예산 안에 드는 가장 오래된 인덱스)을 구하고, ② 그 컷을 {@link
   * #HISTORY_CHUNK_TURNS} 배수로 올림(ceil)해 실제 컷 {@code keepFrom} 으로 삼는다. 올림이라 유지 토큰은 항상 예산 이하이고(하드 캡
   * 준수), 컷은 청크 단위로만 점프하므로 청크 사이 여러 턴 동안 유지 구간의 맨 앞 턴이 고정 → prefix 가 안 흔들려 캐시가 적중한다. 대가로 sliding 보다
   * 최대 한 청크만큼 더 오래된 맥락을 버린다(캐시·맥락 트레이드오프).
   *
   * <p>이 빈은 stateless(매 턴 전체 history 를 새로 받음)이므로, 컷을 오직 입력에서 결정적으로 계산해 같은 대화가 연속 턴에서 같은 prefix 를
   * 내도록 한다(외부 상태 없이 캐시 안정성 확보).
   */
  private List<LlmCallContext.Turn> trimHistoryChunked(
      List<LlmCallContext.Turn> turns, int tokenBudget) {
    int n = turns.size();
    if (n == 0) {
      return List.of();
    }
    // ① sliding 컷 — 최근부터 역순으로 예산 안에 들어가는 가장 오래된 인덱스.
    int tokens = 0;
    int slidingFrom = n; // 최근 한 턴조차 예산 초과면 n(=전부 제외) 유지.
    for (int i = n - 1; i >= 0; i--) {
      int turnTokens = tokenCounter.countTurn(turns.get(i));
      if (tokens + turnTokens > tokenBudget) {
        break;
      }
      tokens += turnTokens;
      slidingFrom = i;
    }
    if (slidingFrom >= n) {
      return List.of(); // 최근 한 턴조차 예산 초과 — 기존 tail-trim 과 동일하게 비운다.
    }
    // ② 컷을 청크 배수로 올림 → keepFrom >= slidingFrom 이라 유지 토큰은 항상 예산 이하, 컷은 청크 단위로만 이동(prefix 고정).
    int keepFrom =
        ((slidingFrom + HISTORY_CHUNK_TURNS - 1) / HISTORY_CHUNK_TURNS) * HISTORY_CHUNK_TURNS;
    if (keepFrom >= n) {
      // 올림이 예산에 드는 최근 턴까지 다 버리는 엣지(드묾) — 정확한 sliding 컷으로 폴백(이 턴만 캐시 깨질 수 있음).
      keepFrom = slidingFrom;
    }
    return new ArrayList<>(turns.subList(keepFrom, n));
  }

  /** 직전 user 메시지 추출 (topic change 비교용). */
  private String lastUserMessage(List<LlmCallContext.Turn> nonSystems) {
    for (int i = nonSystems.size() - 1; i >= 0; i--) {
      LlmCallContext.Turn t = nonSystems.get(i);
      if (t.role() == MessageRole.USER) {
        return t.content();
      }
    }
    return null;
  }
}
