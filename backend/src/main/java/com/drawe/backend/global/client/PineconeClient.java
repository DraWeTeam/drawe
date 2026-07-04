package com.drawe.backend.global.client;

import com.drawe.backend.global.client.dto.PineconeFetchResponse;
import com.drawe.backend.global.client.dto.PineconeMatch;
import com.drawe.backend.global.client.dto.PineconeQueryRequest;
import com.drawe.backend.global.client.dto.PineconeQueryResponse;
import com.drawe.backend.global.client.dto.PineconeUpsertRequest;
import com.drawe.backend.global.client.dto.PineconeVector;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

@Slf4j
@Component
public class PineconeClient {
  private final WebClient webClient;

  public PineconeClient(
      @Value("${pinecone.host}") String pineconeHost, @Value("${pinecone.api-key}") String apiKey) {
    this.webClient =
        WebClient.builder()
            .baseUrl(pineconeHost)
            .defaultHeader("Api-Key", apiKey)
            .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
            .defaultHeader("X-Pinecone-API-Version", "2024-07")
            .build();
  }

  /**
   * 주어진 벡터와 가장 유사한 top-K 이미지의 ID와 점수 반환.
   *
   * @param vector CLIP에서 생성된 768차원 정규화 벡터
   * @param topK 반환할 결과 개수
   * @return 유사도 순으로 정렬된 매치 리스트
   */
  public List<PineconeMatch> queryByVector(List<Float> vector, int topK) {
    try {
      PineconeQueryResponse response =
          webClient
              .post()
              .uri("/query")
              .bodyValue(PineconeQueryRequest.of(vector, topK))
              .retrieve()
              .bodyToMono(PineconeQueryResponse.class)
              .block();

      if (response == null || response.matches() == null) {
        log.warn("Pinecone 응답이 비어있습니다.");
        return List.of();
      }

      log.debug("Pinecone 검색 완료: 결과 {}개", response.matches().size());
      return response.matches();

    } catch (Exception e) {
      log.error("Pinecone 호출 실패: error={}", e.getMessage());
      throw new RuntimeException("벡터 검색 실패: " + e.getMessage(), e);
    }
  }

  /**
   * 이미 색인된 벡터를 id 로 그대로 꺼낸다(재임베딩 없이 재사용). SCRUM-112 "[N]번 유사" 검색에서 레퍼런스 이미지의 저장 벡터를 fetch 해 {@link
   * #queryByVector} 로 이웃을 찾기 위함.
   *
   * @param id Pinecone vector ID (= {@code Image.sourceId})
   * @return 저장된 768차원 벡터. 없거나 호출 실패 시 {@code null}(호출 측이 embedImage 등으로 폴백하도록 예외 대신 null).
   */
  public List<Float> fetchVector(String id) {
    try {
      PineconeFetchResponse response =
          webClient
              .get()
              .uri(uriBuilder -> uriBuilder.path("/vectors/fetch").queryParam("ids", id).build())
              .retrieve()
              .bodyToMono(PineconeFetchResponse.class)
              .block();

      if (response == null || response.vectors() == null) {
        return null;
      }
      PineconeVector v = response.vectors().get(id);
      if (v == null || v.values() == null || v.values().isEmpty()) {
        log.warn("Pinecone fetch: id={} 에 해당하는 벡터 없음", id);
        return null;
      }
      return v.values();
    } catch (Exception e) {
      // 폴백 유도 — 예외 던지지 않고 null 반환(호출 측이 embedImage 등으로 대체).
      log.warn("Pinecone fetch 실패(폴백 유도): id={}, error={}", id, e.getMessage());
      return null;
    }
  }

  /**
   * 벡터 하나를 Pinecone에 upsert. AI 이미지 적재용.
   *
   * @param id Pinecone vector ID. Image.sourceId와 동일 값을 사용 (예: "ai_1234")
   * @param vector L2 정규화된 768차원 CLIP 벡터
   * @param metadata 필터·노출용 메타. 최소 source, createdByUserId, prompt 포함 권장
   */
  public void upsert(String id, List<Float> vector, java.util.Map<String, Object> metadata) {
    PineconeUpsertRequest body =
        new PineconeUpsertRequest(List.of(new PineconeVector(id, vector, metadata)));
    webClient.post().uri("/vectors/upsert").bodyValue(body).retrieve().toBodilessEntity().block();
    log.debug("Pinecone upsert 완료: id={}", id);
  }
}
