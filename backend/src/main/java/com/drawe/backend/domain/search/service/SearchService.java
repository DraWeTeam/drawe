package com.drawe.backend.domain.search.service;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.ImageDraweTag;
import com.drawe.backend.domain.image.repository.ImageDraweTagRepository;
import com.drawe.backend.domain.image.repository.ImageRepository;
import com.drawe.backend.domain.search.dto.ImageResult;
import com.drawe.backend.domain.search.dto.SearchRequest;
import com.drawe.backend.domain.search.dto.SearchResponse;
import com.drawe.backend.global.client.FastApiClient;
import com.drawe.backend.global.client.PineconeClient;
import com.drawe.backend.global.client.dto.PineconeMatch;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SearchService {

  private final FastApiClient fastApiClient;
  private final PineconeClient pineconeClient;
  private final ImageRepository imageRepository;
  private final ImageDraweTagRepository imageDraweTagRepository;
  private final TagIdfIndex tagIdfIndex;
  private final MeterRegistry meterRegistry;

  /**
   * 텍스트 쿼리(검색어)를 받아 유사도 검색 결과를 반환
   *
   * <p>처리 흐름: 1. FastAPI로 쿼리를 768차원 벡터로 변환 2. Pinecone에서 top-K 유사 이미지 ID와 점수 조회 3. MySQL에서 해당 이미지들의
   * 메타데이터를 한 번에 조회 4. Pinecone 순위를 유지하며 응답 조립
   *
   * <p><b>트랜잭션 분리(REQUIRES_NEW):</b> 외부 호출(embed/Pinecone) 장애 시 예외가 이 프록시 경계를 빠져나가며 트랜잭션을
   * rollback-only 로 마킹한다. 만약 호출자({@code ChatLlmService.chat()})의 트랜잭션에 참여(REQUIRED)하면, 호출자가 예외를
   * graceful 하게 catch 해도 호출자 트랜잭션이 이미 더럽혀져 커밋 시점에 {@code UnexpectedRollbackException}(500)이 난다.
   * REQUIRES_NEW 로 별도 트랜잭션을 띄워 검색 실패가 호출자 트랜잭션을 오염시키지 않게 한다. 읽기 쿼리 2개는 한 스냅샷으로 유지.
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
  public SearchResponse search(SearchRequest request) {
    // 무드보드 레퍼런스 검색 계측: 지연 + result(hit/empty=원하는 이미지 못 찾음 비율) + 성패.
    //   export: drawe_reference_search_seconds_{bucket,sum,count}{outcome,result}.
    Timer.Sample sample = Timer.start(meterRegistry);
    String outcome = "success";
    SearchResponse response = null;
    try {
      String query = request.query();
      int topK = request.getTopK();

      log.info("topK:{}", topK);

      // 1. 텍스트 -> 벡터
      List<Float> vector = fastApiClient.embedText(query);

      // 2~6. 벡터 -> Pinecone -> MySQL -> 결과 조립 (벡터 출처와 무관한 공통 경로)
      response = searchByVectorInternal(vector, topK, "query_length=" + query.length(), query);
      return response;
    } catch (RuntimeException e) {
      outcome = "error";
      throw e;
    } finally {
      recordSearchMetric(sample, outcome, response);
    }
  }

  /** 무드보드 검색 계측 기록 — 계측 실패가 검색을 깨지 않게 격리. hit/empty 로 '원하는 걸 못 찾음' 비율을 추적한다. */
  private void recordSearchMetric(Timer.Sample sample, String outcome, SearchResponse response) {
    try {
      String result = (response != null && response.total() > 0) ? "hit" : "empty";
      sample.stop(
          Timer.builder("drawe.reference.search")
              .tag("outcome", outcome)
              .tag("result", result)
              .publishPercentileHistogram()
              .register(meterRegistry));
    } catch (RuntimeException e) {
      log.debug("reference.search 계측 실패(무시): {}", e.getClass().getSimpleName());
    }
  }

  /**
   * 이미지(또는 임의) 벡터로 유사도 검색. 텍스트 {@link #search} 와 동일한 CLIP 공간·동일 조립 경로를 공유하되 1단계(텍스트 임베딩)만 건너뛴다. 010
   * SELF_CRITIQUE 의 "내 작업물과 비슷한 레퍼런스 첨부"(a2)에서 {@code FastApiClient.embedImage} 결과를 그대로 넘겨 호출한다.
   * 설계: {@code docs/decisions/S3A-self-critique-design.md} §7.
   *
   * <p>트랜잭션·외부호출 격리 정책은 {@link #search} 와 동일(REQUIRES_NEW) — 검색 실패가 호출자 트랜잭션을 오염시키지 않는다.
   *
   * @param vector 검색 기준 768차원 벡터 (CLIP). 호출 측이 embedImage 등으로 준비.
   * @param topK 반환 상한
   * @return Pinecone 순위 유지 결과. {@code SearchResponse.query} 는 벡터 검색이라 빈 문자열.
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
  public SearchResponse searchByVector(List<Float> vector, int topK) {
    log.info("searchByVector topK:{}", topK);
    return searchByVectorInternal(vector, topK, "vector_search", "");
  }

  /**
   * 벡터 → Pinecone → MySQL 메타 → ImageResult 조립 공통 경로(텍스트·이미지 검색 공유). 트랜잭션 경계는 진입 public
   * 메서드(REQUIRES_NEW)에 있고, 이 private 헬퍼는 그 안에서 호출된다.
   *
   * @param logCtx 로그용 컨텍스트 문자열(쿼리 길이 등 — 원문 노출 회피)
   * @param echoQuery 응답 {@link SearchResponse#query} 에 담을 값(텍스트 검색은 query, 벡터 검색은 빈 문자열)
   */
  private SearchResponse searchByVectorInternal(
      List<Float> vector, int topK, String logCtx, String echoQuery) {
    // 2. 벡터 -> Pinecone 검색. 텍스트 검색이면 BROAD_K 로 넓게 뽑아 태그 rerank 후 topK 로 자른다(overfetch).
    //    CLIP 이 하위로 민 '태그-강한' 이미지를 보이는 set 으로 끌어올리기 위함(순수 reorder 의 한계 보완).
    boolean willRerank = echoQuery != null && !echoQuery.isBlank();
    int fetchK = willRerank ? Math.max(topK, BROAD_K) : topK;
    List<PineconeMatch> matches = pineconeClient.queryByVector(vector, fetchK);
    if (matches.isEmpty()) {
      log.info("검색 결과 없음: {}", logCtx);
      return new SearchResponse(List.of(), 0, echoQuery);
    }

    // 3. ID 추출 -> MySQL에서 메타데이터 한 번에 조회
    List<String> sourceIds = matches.stream().map(PineconeMatch::id).toList();

    List<Image> images = imageRepository.findBySourceIdIn(sourceIds);

    // 4. 이미지 ID 추출 -> 태그 한 번에 조회
    List<Long> imageIds = images.stream().map(Image::getId).toList();
    List<ImageDraweTag> tags = imageDraweTagRepository.findByImageIdIn(imageIds);
    Map<Long, ImageDraweTag> tagMap =
        tags.stream().collect(Collectors.toMap(t -> t.getImage().getId(), Function.identity()));

    // 5. sourceId 키로 Image 매핑
    Map<String, Image> imageMap =
        images.stream().collect(Collectors.toMap(Image::getSourceId, Function.identity()));

    // 6. Pinecone 순위 유지하면서 ImageResult 조립
    List<ImageResult> results =
        matches.stream()
            .map(
                match -> {
                  Image img = imageMap.get(match.id());
                  if (img == null) {
                    log.warn("Pincone에 있지만 MySQL에 없는 ID: {}", match.id());
                    return null;
                  }
                  ImageDraweTag tag = tagMap.get(img.getId());

                  return new ImageResult(
                      img.getId(),
                      img.getSourceId(),
                      img.getUrl(),
                      img.getPhotographerUsername(),
                      img.getPhotographerName(),
                      match.score(),
                      tag != null ? tag.getTechnique() : null,
                      tag != null ? tag.getSubject() : null,
                      tag != null ? tag.getMood() : null,
                      tag != null ? tag.getUtility() : null,
                      tag != null ? tag.getFreeTags() : null,
                      img.getRawTags() != null ? img.getRawTags() : Collections.emptyList(),
                      img.getSource() != null ? img.getSource().name() : null,
                      img.getPrompt(),
                      img.getAiDescription());
                })
            .filter(r -> r != null)
            .toList();

    // 하이브리드 재정렬: dense(CLIP) 점수 위에 '태그 매칭(IDF 가중)' 소프트 점수를 얹어 다시 정렬 후 topK 로 자른다.
    // 우리가 풍부히 달아둔 태그(특히 Unsplash 원본 rawTags)가 쿼리 키워드와 겹칠수록 위로 올린다.
    // 흔한 태그(실사 "photo" 등)는 IDF 가 낮아 자동 약화, 희귀·변별 태그가 순위를 가른다.
    // ImageResult.score(raw CLIP) 는 보존 — 점수 가드(avg/max)·표시는 dense 점수 그대로, '순서'만 보정.
    List<ImageResult> ranked = rerankByTagOverlap(results, echoQuery);
    if (ranked.size() > topK) {
      ranked = ranked.subList(0, topK); // overfetch 분 잘라 호출자 계약(topK) 유지
    }

    log.info("검색 완료: {}, 반환={}개", logCtx, ranked.size());
    return new SearchResponse(ranked, ranked.size(), echoQuery);
  }

  // ── 태그 기반 하이브리드 재정렬 (dense CLIP + sparse 태그 IDF 매칭) ────────────────

  /** Overfetch 폭 — 텍스트 검색 시 이만큼 넓게 뽑아 태그 rerank 후 topK 로 자른다. */
  private static final int BROAD_K = 40;

  /**
   * Σidf 에 곱하는 스케일 / 가산 상한. CLIP 후보 변별폭(실측 ≈0.02~0.09)에 cap 을 맞춰, 태그가 CLIP 을 통째로 덮어쓰지 않고 '동률 보정·오답
   * 교정' 역할만 하게 한다(cap 0.12 는 CLIP 을 지배 → 0.05 로 낮춤, 데모 검증).
   */
  private static final double IDF_BOOST_SCALE = 0.015;

  private static final double IDF_BOOST_CAP = 0.05;

  /**
   * dense(CLIP) 순위에 태그 매칭(IDF 가중) 소프트 점수를 더해 재정렬한다(하이브리드 retrieval 의 rerank 부).
   *
   * <p>쿼리 토큰이 이미지 태그(기법/주제/분위기/용도 · freeTags · <b>Unsplash 원본 rawTags</b>)에 겹치면 그 토큰의 IDF 만큼 가산한다 —
   * 흔한 태그는 IDF≈0 으로 자동 무력화, 희귀·변별 태그가 순위를 가른다. 가산 동률이면 기존 Pinecone 순서 유지(stable). 쿼리가 비었거나(=이미지
   * 벡터검색·010 self-critique) 결과 1개 이하면 그대로 둔다.
   *
   * <p>{@code ImageResult.score}(raw CLIP) 는 보존 — 점수 가드·표시 유사도는 dense 그대로, 순서만 보정(가드 회귀 없음).
   */
  private List<ImageResult> rerankByTagOverlap(List<ImageResult> results, String query) {
    Set<String> queryTokens = TagIdfIndex.tokensOf(query);
    if (queryTokens.isEmpty() || results.size() < 2) {
      return results;
    }
    return results.stream()
        .sorted(
            Comparator.comparingDouble(
                    (ImageResult r) -> r.score().doubleValue() + tagBoost(r, queryTokens))
                .reversed())
        .toList();
  }

  /** 쿼리 토큰이 이미지 태그에 겹친 토큰들의 IDF 합 × 스케일(상한 캡). 태그가 없으면 0. */
  private double tagBoost(ImageResult r, Set<String> queryTokens) {
    Set<String> tags = tagTokens(r);
    if (tags.isEmpty()) {
      return 0.0;
    }
    double sum = 0.0;
    for (String token : queryTokens) {
      if (tags.contains(token)) {
        sum += tagIdfIndex.idf(token);
      }
    }
    return Math.min(IDF_BOOST_CAP, IDF_BOOST_SCALE * sum);
  }

  /** 이미지의 모든 태그를 토큰 집합으로. 구조화 태그(기법/주제/분위기/용도) + freeTags + rawTags(Unsplash 원본). */
  private static Set<String> tagTokens(ImageResult r) {
    Set<String> tokens = new HashSet<>(TagIdfIndex.tokensOf(r.technique(), r.subject(), r.mood()));
    tokens.addAll(TagIdfIndex.tokensOf(r.utility()));
    tokens.addAll(TagIdfIndex.tokensOf(r.freeTags()));
    tokens.addAll(TagIdfIndex.tokensOf(r.rawTags()));
    tokens.addAll(TagIdfIndex.tokensOf(r.prompt())); // AI 이미지: raw_tags 없음 → 영문 프롬프트가 내용 신호
    tokens.addAll(TagIdfIndex.tokensOf(r.aiDescription())); // Unsplash: 네이티브 AI 캡션(문장)도 내용 신호
    return tokens;
  }
}
