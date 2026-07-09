package com.drawe.backend.domain.admin.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.drawe.backend.domain.admin.dto.SearchQualityModel.WordRank;
import com.drawe.backend.domain.admin.service.SearchKeywordTokenizer.KeywordCount;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 어절 토크나이저(순수 유틸) 단위 테스트 — 규칙 기반 근사 동작 확인. */
class SearchKeywordTokenizerTest {

  private static Map<String, Long> freq(List<KeywordCount> src) {
    return SearchKeywordTokenizer.rank(src, 100).stream()
        .collect(Collectors.toMap(WordRank::word, WordRank::count));
  }

  @Test
  @DisplayName("공백분리_빈도합산")
  void splitsOnWhitespaceAndSumsFrequency() {
    // "man bright" 2회 + "man" 3회 → man=5, bright=2
    Map<String, Long> f =
        freq(List.of(new KeywordCount("man bright", 2), new KeywordCount("man", 3)));
    assertThat(f).containsEntry("man", 5L).containsEntry("bright", 2L);
  }

  @Test
  @DisplayName("영어_불용어_제거")
  void removesEnglishStopwords() {
    Map<String, Long> f = freq(List.of(new KeywordCount("the man in a room", 1)));
    // the/in/a 는 불용어로 제거, man/room 만 남음
    assertThat(f).containsOnlyKeys("man", "room");
  }

  @Test
  @DisplayName("한국어_조사_제거")
  void stripsKoreanParticles() {
    Map<String, Long> f = freq(List.of(new KeywordCount("남자를", 1), new KeywordCount("남자", 1)));
    // "남자를" → "남자" 로 정규화되어 "남자"=2 로 합산
    assertThat(f).containsEntry("남자", 2L).doesNotContainKey("남자를");
  }

  @Test
  @DisplayName("한국어_조사_긴것_우선_에서")
  void stripsLongerKoreanParticleFirst() {
    Map<String, Long> f = freq(List.of(new KeywordCount("집에서", 1)));
    assertThat(f).containsOnlyKeys("집"); // "에서" 제거 (not "에" 만)
  }

  @Test
  @DisplayName("단순_복수_정규화")
  void normalizesSimplePlural() {
    Map<String, Long> f = freq(List.of(new KeywordCount("cats", 2), new KeywordCount("cat", 1)));
    assertThat(f).containsEntry("cat", 3L).doesNotContainKey("cats");
  }

  @Test
  @DisplayName("복수_ss는_보존")
  void preservesPluralEndingWithSs() {
    // "dress"(ss로 끝) 는 그대로 유지 — 과한 stemming 방지
    Map<String, Long> f = freq(List.of(new KeywordCount("dress", 4)));
    assertThat(f).containsOnlyKeys("dress");
  }

  @Test
  @DisplayName("빈_토큰_제거")
  void removesEmptyTokens() {
    // 조사만 있는 토큰("가")·공백은 버림
    Map<String, Long> f = freq(List.of(new KeywordCount("  가   man ", 1)));
    assertThat(f).containsOnlyKeys("man");
  }

  @Test
  @DisplayName("대문자_소문자화")
  void lowercasesUppercase() {
    Map<String, Long> f = freq(List.of(new KeywordCount("Man BRIGHT", 1)));
    assertThat(f).containsOnlyKeys("man", "bright");
  }

  @Test
  @DisplayName("빈도_내림차순_topN")
  void ranksByFrequencyDescendingTopN() {
    List<WordRank> top =
        SearchKeywordTokenizer.rank(
            List.of(
                new KeywordCount("man", 5),
                new KeywordCount("bright", 3),
                new KeywordCount("church", 1)),
            2);
    assertThat(top).extracting(WordRank::word).containsExactly("man", "bright");
  }

  @Test
  @DisplayName("null_안전")
  void nullSafe() {
    assertThat(SearchKeywordTokenizer.rank(null, 10)).isEmpty();
    assertThat(freq(List.of(new KeywordCount(null, 3)))).isEmpty();
  }
}
