package com.drawe.backend.domain.llm.context;

import static org.assertj.core.api.Assertions.assertThat;

import com.drawe.backend.domain.enums.MessageRole;
import com.drawe.backend.domain.llm.dto.LlmCallContext;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class TokenAwareHistoryTrimmerTest {

  private TokenAwareHistoryTrimmer trimmer;
  private TokenCounter counter;
  private TokenBudgetConfig budget;
  private SimpleMeterRegistry registry;

  @BeforeEach
  void setUp() {
    counter = new TokenCounter();
    HistorySanitizer sanitizer = new HistorySanitizer();
    NoopTopicChangeDetector detector = new NoopTopicChangeDetector();
    budget = new TokenBudgetConfig();
    registry = new SimpleMeterRegistry();

    trimmer = new TokenAwareHistoryTrimmer(counter, sanitizer, detector, budget, registry);
    trimmer.init();
  }

  @Test
  @DisplayName("빈 입력은 빈 리스트")
  void emptyInputReturnsEmpty() {
    assertThat(trimmer.trim(null, "msg")).isEmpty();
    assertThat(trimmer.trim(List.of(), "msg")).isEmpty();
  }

  @Test
  @DisplayName("예산 안의 작은 history 는 그대로 보존")
  void smallHistoryPreserved() {
    List<LlmCallContext.Turn> turns =
        List.of(
            new LlmCallContext.Turn(MessageRole.SYSTEM, "페르소나"),
            new LlmCallContext.Turn(MessageRole.USER, "안녕"),
            new LlmCallContext.Turn(MessageRole.ASSISTANT, "안녕하세요"));

    List<LlmCallContext.Turn> result = trimmer.trim(turns, "오늘 뭐할까");

    assertThat(result).hasSize(3);
  }

  @Test
  @DisplayName("SYSTEM 먼저, USER·ASSISTANT 나중 순서 유지")
  void preservesOrderSystemFirst() {
    List<LlmCallContext.Turn> turns =
        List.of(
            new LlmCallContext.Turn(MessageRole.USER, "u1"),
            new LlmCallContext.Turn(MessageRole.SYSTEM, "sys1"),
            new LlmCallContext.Turn(MessageRole.ASSISTANT, "a1"),
            new LlmCallContext.Turn(MessageRole.SYSTEM, "sys2"));

    List<LlmCallContext.Turn> result = trimmer.trim(turns, "현재");

    // SYSTEM 들이 먼저 나옴
    assertThat(result.get(0).role()).isEqualTo(MessageRole.SYSTEM);
    assertThat(result.get(1).role()).isEqualTo(MessageRole.SYSTEM);
    // 그 다음 USER·ASSISTANT
    assertThat(result.get(2).role()).isIn(MessageRole.USER, MessageRole.ASSISTANT);
  }

  @Test
  @DisplayName("History 예산 초과 시 오래된 것부터 제거")
  void trimsOldestFirst() {
    budget.setHistoryBudget(50); // 매우 작은 예산

    List<LlmCallContext.Turn> turns = new ArrayList<>();
    for (int i = 0; i < 20; i++) {
      turns.add(new LlmCallContext.Turn(MessageRole.USER, "메시지 번호 " + i));
    }

    List<LlmCallContext.Turn> result = trimmer.trim(turns, "현재");

    // 일부만 남음
    assertThat(result.size()).isLessThan(20);

    // 가장 최근 메시지는 포함됨
    String lastContent = result.get(result.size() - 1).content();
    assertThat(lastContent).contains("19");
  }

  @Test
  @DisplayName("SYSTEM 예산 초과 시 일부만 포함")
  void trimsSystemToBudget() {
    budget.setSystemBudget(20); // 매우 작은 예산

    List<LlmCallContext.Turn> turns = new ArrayList<>();
    for (int i = 0; i < 10; i++) {
      turns.add(
          new LlmCallContext.Turn(MessageRole.SYSTEM, "system message number " + i + " content"));
    }

    List<LlmCallContext.Turn> result = trimmer.trim(turns, "msg");

    long systemCount = result.stream().filter(t -> t.role() == MessageRole.SYSTEM).count();
    assertThat(systemCount).isLessThan(10);
  }

  @Test
  @DisplayName("[N] 마커는 USER·ASSISTANT 에서 제거됨")
  void referencesStripped() {
    List<LlmCallContext.Turn> turns =
        List.of(new LlmCallContext.Turn(MessageRole.ASSISTANT, "[1]번 이미지처럼"));

    List<LlmCallContext.Turn> result = trimmer.trim(turns, "현재");

    assertThat(result).hasSize(1);
    assertThat(result.get(0).content()).doesNotContain("[1]");
  }

  @Test
  @DisplayName("입력 토큰 메트릭 기록됨")
  void recordsInputTokensMetric() {
    List<LlmCallContext.Turn> turns = List.of(new LlmCallContext.Turn(MessageRole.USER, "안녕"));

    trimmer.trim(turns, "현재 메시지");

    double count = registry.get("drawe.tokens.input").summary().count();
    assertThat(count).isPositive();
  }

  @Test
  @DisplayName("Trim 카운터 메트릭 — 예산 초과 시 증가")
  void recordsTrimmedMetric() {
    budget.setHistoryBudget(20);

    List<LlmCallContext.Turn> turns = new ArrayList<>();
    for (int i = 0; i < 30; i++) {
      turns.add(new LlmCallContext.Turn(MessageRole.USER, "긴 메시지 " + i));
    }

    trimmer.trim(turns, "현재");

    double count = registry.get("drawe.history.trimmed").counter().count();
    assertThat(count).isPositive();
  }

  @Test
  @DisplayName("청크 trim — 연속 턴에서 유지 시작점이 청크 단위로만 바뀌고(캐시 안정), 예산을 넘지 않는다")
  void chunkTrimKeepsPrefixStable() {
    // 청크는 "예산이 최소 한 청크 이상을 담을 때" 효과가 난다(프로덕션 budget=4000 ≫ 6턴). 그래서 윈도우가 청크보다 충분히 크도록
    // 예산을 턴 크기 기반으로 잡는다(토크나이저 무관하게 결정적).
    int perTurnTokens =
        counter.countTurn(new LlmCallContext.Turn(MessageRole.USER, turnContent(0)));
    int holdTurns = 15; // 윈도우가 ~15턴 → 청크(6)보다 충분히 큼
    budget.setHistoryBudget(perTurnTokens * holdTurns);
    budget.setSystemBudget(100_000); // SYSTEM 은 영향 없게 충분히 크게

    LlmCallContext.Turn system = new LlmCallContext.Turn(MessageRole.SYSTEM, "고정 페르소나 블록");
    List<LlmCallContext.Turn> nonSystems = new ArrayList<>();

    List<String> prevKept = null;
    String prevFront = null;
    int frontChanges = 0; // 유지 시작점(맨 앞 턴)이 바뀐 스텝 수 — 슬라이딩이면 거의 매 스텝, 청크면 드물게
    int activeSteps = 0; // 실제로 일부가 잘린 스텝 수

    // 대화를 한 턴씩 늘리며(=실사용처럼 매 턴 전체 history 를 새로 trim) 불변식을 검사.
    for (int k = 0; k < 70; k++) {
      MessageRole role = (k % 2 == 0) ? MessageRole.USER : MessageRole.ASSISTANT;
      nonSystems.add(new LlmCallContext.Turn(role, turnContent(k)));

      List<LlmCallContext.Turn> all = new ArrayList<>();
      all.add(system);
      all.addAll(nonSystems);

      List<String> kept =
          trimmer.trim(all, "현재 질문").stream()
              .filter(t -> t.role() != MessageRole.SYSTEM)
              .map(LlmCallContext.Turn::content)
              .toList();
      if (kept.isEmpty()) {
        continue;
      }

      // ① 예산 준수 — 유지된 비-SYSTEM 토큰은 항상 historyBudget 이하(올림 컷의 하드 캡).
      int keptTokens = kept.stream().mapToInt(counter::count).sum();
      assertThat(keptTokens).isLessThanOrEqualTo(budget.getHistoryBudget());

      if (kept.size() < nonSystems.size()) {
        activeSteps++;
      }

      String front = kept.get(0);
      if (prevFront != null) {
        if (front.equals(prevFront)) {
          // ② 시작점이 고정된 스텝 → 직전 유지 리스트는 현재의 prefix 여야 캐시 재사용이 성립(앞 고정 + 뒤에만 추가).
          assertThat(kept.subList(0, prevKept.size())).isEqualTo(prevKept);
        } else {
          frontChanges++;
        }
      }
      prevFront = front;
      prevKept = kept;
    }

    // 트리밍이 충분히 일어났는데도, 시작점은 매 스텝이 아니라 청크 단위로만 점프한다
    // (슬라이딩이면 frontChanges ≈ activeSteps, 청크면 ≈ activeSteps / 청크크기(6)).
    assertThat(activeSteps).isGreaterThan(10);
    assertThat(frontChanges).isLessThanOrEqualTo(activeSteps / 3);
  }

  /** 길이가 거의 일정한(인덱스 3자리 패딩) 턴 내용 — 예산 대비 윈도우 크기를 결정적으로 만든다. */
  private static String turnContent(int i) {
    return String.format("대화 히스토리의 한 턴입니다 번호 %03d", i);
  }
}
