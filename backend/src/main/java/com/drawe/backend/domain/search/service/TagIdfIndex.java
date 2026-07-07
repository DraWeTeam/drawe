package com.drawe.backend.domain.search.service;

import com.drawe.backend.domain.ImageDraweTag;
import com.drawe.backend.domain.image.repository.ImageDraweTagRepository;
import com.drawe.backend.domain.image.repository.ImageRepository;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 태그 IDF(역문서빈도) 색인 — 검색 rerank 의 '태그 변별력' 가중치 원천.
 *
 * <p>흔한 태그(실사 코퍼스의 "photo" 등)는 df 가 높아 IDF≈0 → 가산 거의 0(자동 무력화), 희귀·변별 태그는 IDF 가 커서 rerank 를 가른다.
 * "Unsplash 실사라 태그가 다양하지 않다"는 문제를 하드코딩 없이 데이터로 자기조정한다.
 *
 * <p>코퍼스(Image.raw_tags = Unsplash 키워드 전체 + ImageDraweTag 자동태깅)를 1회 스캔해 토큰별 IDF 맵을 만든다. 기동 완료 후 별도
 * 스레드로 빌드(부팅 비차단). 빌드 전/실패 시 빈 맵 → {@link #idf}=0 → rerank 가 순수 CLIP 으로 자연 폴백한다. 코퍼스는 천천히 변하므로 재적재
 * 후 앱 재시작(또는 {@link #refresh} 수동 호출)으로 갱신한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TagIdfIndex {

  private final ImageRepository imageRepository;
  private final ImageDraweTagRepository imageDraweTagRepository;

  /** 토큰 → IDF. volatile 로 원자 교체(rerank 스레드가 빌드 중에도 일관된 스냅샷을 본다). */
  private volatile Map<String, Double> idfMap = Map.of();

  /** 기동 완료 후 백그라운드 1회 빌드. @EnableScheduling/@EnableAsync 의존 없이 직접 스레드(부팅 비차단). */
  @EventListener(ApplicationReadyEvent.class)
  public void buildOnStartup() {
    Thread t = new Thread(this::refresh, "tag-idf-build");
    t.setDaemon(true);
    t.start();
  }

  /** 토큰의 IDF (모르는 토큰=0 → 가산 없음). */
  public double idf(String token) {
    return idfMap.getOrDefault(token, 0.0);
  }

  /** 코퍼스를 스캔해 df→IDF 를 재계산하고 원자적으로 교체한다. */
  public void refresh() {
    try {
      Map<String, Integer> df = new HashMap<>();
      long docs = 0;

      // ① Unsplash 원본 키워드(고변별 신호). JSON 텍스트를 그대로 토큰화 — 구두점이 구분자라 파싱 불필요.
      for (String rawJson : imageRepository.findAllRawTagsJson()) {
        docs++;
        for (String token : tokensOf(rawJson)) {
          df.merge(token, 1, Integer::sum);
        }
      }

      // ② AI 이미지 내용 신호 — 영문 프롬프트(raw_tags 없음). 불용어는 df 높아 IDF≈0 으로 자연 약화.
      for (String prompt : imageRepository.findAllPrompts()) {
        docs++;
        for (String token : tokensOf(prompt)) {
          df.merge(token, 1, Integer::sum);
        }
      }

      // ③ 자동 태깅 구조화 축(저변별 → df 높음 → IDF 낮음, 자동 약화).
      for (ImageDraweTag tag : imageDraweTagRepository.findAll()) {
        Set<String> tokens = tokensOf(tag.getTechnique(), tag.getSubject(), tag.getMood());
        tokens.addAll(tokensOf(tag.getUtility()));
        tokens.addAll(tokensOf(tag.getFreeTags()));
        for (String token : tokens) {
          df.merge(token, 1, Integer::sum);
        }
      }

      long n = Math.max(docs, 1);
      Map<String, Double> next = new HashMap<>(Math.max(16, df.size() * 2));
      for (Map.Entry<String, Integer> e : df.entrySet()) {
        // ln((N+1)/(df+1)): 흔할수록 0 에 수렴, 희귀할수록 큼. 음수(초과빈도)는 0 클램프.
        double idf = Math.log((n + 1.0) / (e.getValue() + 1.0));
        next.put(e.getKey(), Math.max(0.0, idf));
      }
      this.idfMap = next;
      log.info("TagIdfIndex 빌드 완료: docs={}, tokens={}", n, next.size());
    } catch (Exception e) {
      log.error(
          "TagIdfIndex 빌드 실패(빈 맵 유지 → rerank 는 순수 CLIP 으로 폴백): error_class={}",
          e.getClass().getSimpleName());
    }
  }

  // ── 토큰화 (검색 rerank 와 '동일 규칙'을 공유하는 단일 출처) ──────────────────────

  /** 소문자화 후 비-영숫자 기준 분할, 2자 미만 제거. {@code \p{L}} 이라 한글 토큰 유지. JSON/구두점도 구분자로 흡수. */
  public static Set<String> tokensOf(String... values) {
    Set<String> out = new HashSet<>();
    for (String v : values) {
      addTokens(out, v);
    }
    return out;
  }

  public static Set<String> tokensOf(List<String> values) {
    Set<String> out = new HashSet<>();
    if (values != null) {
      for (String v : values) {
        addTokens(out, v);
      }
    }
    return out;
  }

  private static void addTokens(Set<String> out, String v) {
    if (v == null || v.isBlank()) {
      return;
    }
    for (String t : v.toLowerCase().split("[^\\p{L}\\p{N}]+")) {
      if (t.length() >= 2) {
        out.add(t);
      }
    }
  }
}
