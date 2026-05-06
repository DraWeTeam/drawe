package com.drawe.backend.global.client;

import com.drawe.backend.global.client.dto.EmbedRequest;
import com.drawe.backend.global.client.dto.EmbedResponse;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

@Slf4j
@Component
public class FastApiClient {

  private final WebClient webClient;

  public FastApiClient(@Value("${fastapi.url}") String fastApiUrl) {
    this.webClient =
        WebClient.builder()
            .baseUrl(fastApiUrl)
            .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
            .build();
  }

  /** 텍스트 -> 768차원 CLIP 벡터로 변환. */
  public List<Float> embedText(String text) {
    try {
      EmbedResponse response =
          webClient
              .post()
              .uri("/embed/text")
              .bodyValue(new EmbedRequest(text))
              .retrieve()
              .bodyToMono(EmbedResponse.class)
              .block();

      if (response == null || response.embedding() == null) {
        throw new IllegalStateException("FastAPI 응답이 비었습니다.");
      }

      log.debug("FastAPI 임베딩 성공: text='{}', dimension={}", text, response.dimension());
      return response.embedding();
    } catch (Exception e) {
      log.error("FastAPI 호출 실패: text='{}', error={}", text, e.getMessage());
      throw new RuntimeException("임베딩 변환 실패: " + e.getMessage(), e);
    }
  }
}
