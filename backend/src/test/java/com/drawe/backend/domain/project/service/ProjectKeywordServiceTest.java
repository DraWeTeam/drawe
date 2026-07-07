package com.drawe.backend.domain.project.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.drawe.backend.domain.llm.dto.LlmCallResult;
import com.drawe.backend.domain.llm.service.GrokService;
import com.drawe.backend.domain.project.dto.KeywordClassification;
import com.drawe.backend.domain.project.dto.KeywordExtractionResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** SCRUM-115 — 주제 키워드 추출/분류(Grok) 파싱·폴백 단위 테스트. */
@ExtendWith(MockitoExtension.class)
class ProjectKeywordServiceTest {

  @Mock GrokService grokService;

  ProjectKeywordService service;

  @BeforeEach
  void setUp() {
    service = new ProjectKeywordService(grokService, new ObjectMapper());
  }

  private static LlmCallResult grokReturns(String content) {
    return new LlmCallResult(content, "grok", 10, null, null);
  }

  @Test
  @DisplayName("추출: 이름은 주제 입력 그대로, 키워드만 Grok으로 추출")
  void extract_nameIsTopic_keywordsFromGrok() {
    when(grokService.generate(any())).thenReturn(grokReturns("[\"따뜻한\",\"햇빛\",\"카페\",\"여성\"]"));

    KeywordExtractionResponse res = service.extract("햇빛이 드는 카페의 창가에 앉아있는 여성");

    assertThat(res.name()).isEqualTo("햇빛이 드는 카페의 창가에 앉아있는 여성"); // 입력 그대로
    assertThat(res.keywords()).containsExactly("따뜻한", "햇빛", "카페", "여성");
  }

  @Test
  @DisplayName("추출: Grok 실패 시 이름=주제, 키워드=빈 리스트로 degrade")
  void extract_grokFail_degradesToTopic() {
    when(grokService.generate(any())).thenThrow(new RuntimeException("boom"));

    KeywordExtractionResponse res = service.extract("고양이 그림");

    assertThat(res.name()).isEqualTo("고양이 그림");
    assertThat(res.keywords()).isEmpty();
  }

  @Test
  @DisplayName("분류: 키워드 중 subject/mood/technique 선택")
  void classify_picksFromKeywords() {
    when(grokService.generate(any()))
        .thenReturn(grokReturns("{\"subject\":\"여성\",\"mood\":\"따뜻한\",\"technique\":null}"));

    KeywordClassification c = service.classify(List.of("따뜻한", "햇빛", "카페", "여성"));

    assertThat(c.subject()).isEqualTo("여성");
    assertThat(c.mood()).isEqualTo("따뜻한");
    assertThat(c.technique()).isNull();
  }

  @Test
  @DisplayName("분류: 리스트 밖 subject 는 첫 키워드로 폴백, 리스트 밖 mood 는 null")
  void classify_outOfListValues_areSanitized() {
    when(grokService.generate(any()))
        .thenReturn(grokReturns("{\"subject\":\"강아지\",\"mood\":\"차가운\",\"technique\":null}"));

    KeywordClassification c = service.classify(List.of("따뜻한", "카페"));

    assertThat(c.subject()).isEqualTo("따뜻한"); // 강아지는 리스트 밖 → 첫 키워드
    assertThat(c.mood()).isNull(); // 차가운도 리스트 밖 → null
  }

  @Test
  @DisplayName("분류: Grok 실패 시 subject=첫 키워드로 degrade")
  void classify_grokFail_fallsBackToFirst() {
    when(grokService.generate(any())).thenThrow(new RuntimeException("boom"));

    KeywordClassification c = service.classify(List.of("카페", "여성"));

    assertThat(c.subject()).isEqualTo("카페");
    assertThat(c.mood()).isNull();
    assertThat(c.technique()).isNull();
  }

  @Test
  @DisplayName("분류: 키워드 없으면 전부 null, Grok 호출 안 함")
  void classify_emptyKeywords_allNull() {
    KeywordClassification c = service.classify(List.of());

    assertThat(c.subject()).isNull();
    assertThat(c.mood()).isNull();
    assertThat(c.technique()).isNull();
    verifyNoInteractions(grokService);
  }
}
