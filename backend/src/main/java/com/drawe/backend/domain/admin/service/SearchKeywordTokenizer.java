package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.SearchQualityModel.WordRank;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 검색어(extracted_keywords) → 어절(단어) 빈도 랭킹. 순수 함수 유틸(상태·I/O 없음 → 테스트 용이).
 *
 * <p><b>형태소 분석기가 아니다.</b> 공백 분리 + 영어 불용어 + 한국어 끝조사 제거 + 단순 복수 정규화의 규칙 기반 근사다. 방향성(무슨 어절이 많이 검색되나)은
 * 보지만 정밀 형태소는 못 본다.
 *
 * <p>{@code extracted_keywords}는 SearchExecutor가 {@code String.join(" ", keywords)}로 공백 조인 + 소문자
 * 저장하므로 공백 분리·소문자화는 사실상 완료 상태(방어적으로 재적용).
 */
public final class SearchKeywordTokenizer {

  private SearchKeywordTokenizer() {}

  /** 집계 입력 — (키워드 문자열, 발생 횟수). 레포 projection과 분리해 유틸을 순수하게 유지. */
  public record KeywordCount(String keyword, long count) {}

  /** 영어 불용어(보수적). */
  private static final Set<String> STOPWORDS =
      Set.of(
          "the", "a", "an", "and", "or", "of", "in", "on", "with", "for", "to", "is", "are", "at",
          "by", "from", "as", "it", "this", "that");

  /** 한국어 끝조사 — 긴 것 먼저(에서→에, 으로→로 순으로 매칭)로 정렬. 첫 매칭 1개만 제거. */
  private static final List<String> JOSA =
      List.of(
          "에서", "으로", "까지", "부터", "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과", "도", "만");

  /** 어절 빈도 랭킹 상위 {@code topN}. 각 토큰 빈도는 해당 키워드의 {@code count}만큼 가중 합산. 동점은 어절 사전순. */
  public static List<WordRank> rank(List<KeywordCount> sources, int topN) {
    Map<String, Long> freq = new HashMap<>();
    if (sources != null) {
      for (KeywordCount kc : sources) {
        if (kc == null || kc.keyword() == null) {
          continue;
        }
        for (String raw : kc.keyword().split("\\s+")) {
          String token = normalize(raw);
          if (token != null) {
            freq.merge(token, kc.count(), Long::sum);
          }
        }
      }
    }
    return freq.entrySet().stream()
        .sorted(
            Comparator.comparingLong(Map.Entry<String, Long>::getValue)
                .reversed()
                .thenComparing(Map.Entry::getKey))
        .limit(Math.max(0, topN))
        .map(e -> new WordRank(e.getKey(), e.getValue()))
        .toList();
  }

  /** 한 토큰 정규화: trim → 소문자 → 끝조사 1개 제거 → 불용어 버림 → 단순 복수(-s) 정규화. 빈 문자열이 되면 {@code null}(버림). */
  static String normalize(String raw) {
    if (raw == null) {
      return null;
    }
    String t = raw.trim().toLowerCase(Locale.ROOT);
    if (t.isEmpty()) {
      return null;
    }
    // 한국어 끝조사 1개 제거(가장 긴 매칭 우선). 예: "남자를" → "남자", "집에서" → "집".
    for (String j : JOSA) {
      if (t.endsWith(j)) {
        t = t.substring(0, t.length() - j.length());
        break;
      }
    }
    if (t.isEmpty()) {
      return null;
    }
    // 영어 불용어는 조사 제거 뒤에 판정(this/that 등이 복수 규칙에 잘못 걸리지 않게).
    if (STOPWORDS.contains(t)) {
      return null;
    }
    // 단순 복수 정규화(과하지 않게): 길이>3, -s로 끝나되 -ss는 제외. cats→cat, eyes→eye. dress 유지.
    if (t.length() > 3 && t.endsWith("s") && !t.endsWith("ss")) {
      t = t.substring(0, t.length() - 1);
    }
    return t.isEmpty() ? null : t;
  }
}
