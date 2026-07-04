package com.drawe.backend.domain.project.service;

import com.drawe.backend.domain.enums.MessageRole;
import com.drawe.backend.domain.llm.dto.LlmCallContext;
import com.drawe.backend.domain.llm.service.GrokService;
import com.drawe.backend.domain.project.dto.KeywordClassification;
import com.drawe.backend.domain.project.dto.KeywordExtractionResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Arrays;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 프로젝트 생성용 Grok 유틸(SCRUM-115).
 *
 * <ul>
 *   <li>{@link #extract} — 주제 문장 → 프로젝트 이름 + 키워드 칩 (사용자 대면, 편집 가능)
 *   <li>{@link #classify} — 사용자가 편집한 키워드 → subject(필수)/mood/technique 백그라운드 분류(생성 시)
 * </ul>
 *
 * <p>둘 다 Grok 실패 시 계약대로 graceful degrade — 요청은 안 깨진다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectKeywordService {

  private static final int MAX_KEYWORDS = 6;

  private static final String EXTRACT_PROMPT =
      """
      너는 그림 창작 주제 문장에서 레퍼런스 검색 키워드를 뽑는 추출기다.
      입력 주제에서 그림 레퍼런스 검색용 핵심 한국어 키워드를 최대 %d개 골라 JSON 문자열 배열로만 반환하라.
      문장에 직접 있는 주제/사물과, 그 장면에서 자연스럽게 연상되는 분위기를 함께 넣어라.
      - 분위기 형용사·주제 명사·색감·구도 등, 자연스러운 한국어 형태("따뜻한","밝은","카페","여성")
      - "그려줘/찾아줘/만들어줘" 같은 요청 동사는 제외
      설명·코드펜스 없이 JSON 문자열 배열만. 예: ["따뜻한","밝은","몽환적인","카페","창가","여성"]
      """
          .formatted(MAX_KEYWORDS);

  private static final String CLASSIFY_PROMPT =
      """
      너는 그림 키워드 분류기다. 주어진 키워드 리스트에 있는 단어만 골라 JSON 객체로 반환하라(새 단어 금지):
      - subject: 그림의 주제(명사) 키워드 하나 (필수)
      - mood: 분위기 형용사 키워드 하나 (없으면 null)
      - technique: 기법/화풍 키워드 하나(수채화·유화·펜화 등, 없으면 null)
      설명·코드펜스 없이 JSON 객체만.
      예: {"subject":"여성","mood":"따뜻한","technique":null}
      """;

  private final GrokService grokService;
  private final ObjectMapper objectMapper;

  /** 주제 문장 → 키워드 추출. 프로젝트 이름은 사용자 입력(주제) 그대로 쓰고, 키워드만 Grok. Grok 실패 시 키워드 빈 리스트로 degrade. */
  public KeywordExtractionResponse extract(String topic) {
    return new KeywordExtractionResponse(truncate(topic, 100), extractKeywords(topic));
  }

  private List<String> extractKeywords(String topic) {
    try {
      String[] arr =
          objectMapper.readValue(extractJsonArray(call(EXTRACT_PROMPT, topic)), String[].class);
      return Arrays.stream(arr)
          .filter(k -> k != null && !k.isBlank())
          .map(String::trim)
          .distinct()
          .limit(MAX_KEYWORDS)
          .toList();
    } catch (Exception e) {
      log.warn("주제 키워드 추출 실패 — 빈 키워드로 degrade: error_class={}", e.getClass().getSimpleName());
      return List.of();
    }
  }

  /** 키워드 → subject(필수)/mood/technique 백그라운드 분류. 리스트 밖 단어는 무시, Grok 실패 시 subject=첫 키워드로 degrade. */
  public KeywordClassification classify(List<String> keywords) {
    if (keywords == null || keywords.isEmpty()) {
      return new KeywordClassification(null, null, null);
    }
    try {
      KeywordClassification c =
          objectMapper.readValue(
              extractJsonObject(call(CLASSIFY_PROMPT, String.join(", ", keywords))),
              KeywordClassification.class);
      // 리스트에 없는 단어는 버린다(subject 는 필수라 첫 키워드로 폴백). null-safe: List.of(..).contains(null) 은 NPE.
      String subject =
          c.subject() != null && keywords.contains(c.subject()) ? c.subject() : keywords.get(0);
      String mood = c.mood() != null && keywords.contains(c.mood()) ? c.mood() : null;
      String technique =
          c.technique() != null && keywords.contains(c.technique()) ? c.technique() : null;
      return new KeywordClassification(subject, mood, technique);
    } catch (Exception e) {
      log.warn("키워드 분류 실패 — subject=첫 키워드로 degrade: error_class={}", e.getClass().getSimpleName());
      return new KeywordClassification(keywords.get(0), null, null);
    }
  }

  private String call(String systemPrompt, String userMessage) {
    LlmCallContext ctx =
        new LlmCallContext(
            List.of(new LlmCallContext.Turn(MessageRole.SYSTEM, systemPrompt)),
            userMessage,
            null,
            null);
    return grokService.generate(ctx).content();
  }

  /** 코드펜스/설명이 섞여도 첫 '[' ~ 마지막 ']' 구간만 잘라 JSON 배열로 시도. */
  private static String extractJsonArray(String content) {
    if (content == null) {
      return "[]";
    }
    int s = content.indexOf('[');
    int e = content.lastIndexOf(']');
    return (s >= 0 && e > s) ? content.substring(s, e + 1) : content;
  }

  /** 코드펜스/설명이 섞여도 첫 '{' ~ 마지막 '}' 구간만 잘라 JSON 객체로 시도. */
  private static String extractJsonObject(String content) {
    if (content == null) {
      return "{}";
    }
    int s = content.indexOf('{');
    int e = content.lastIndexOf('}');
    return (s >= 0 && e > s) ? content.substring(s, e + 1) : content;
  }

  private static String truncate(String s, int max) {
    if (s == null) {
      return null;
    }
    return s.length() > max ? s.substring(0, max) : s;
  }
}
