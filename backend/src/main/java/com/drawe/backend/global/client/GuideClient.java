package com.drawe.backend.global.client;

import com.drawe.backend.global.client.dto.GuideResponse;
import java.time.Duration;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.util.retry.Retry;

/**
 * 이미지 가이딩 전용 FastAPI 클라이언트.
 *
 * <p>embed 와 *별도 ECS 서비스*(Service Connect: fastapi-guide.drawe-{env}.local:8000)라
 * {@code ${fastapi.guide.url}} 를 따로 쓴다. /guide 계약: multipart/form-data, file field name = "file".
 * request_id(멱등 키)를 함께 보내므로, 네트워크 재시도가 발생해도 fastapi 가 부작용을 at-most-once 로 처리한다.
 */
@Slf4j
@Component
public class GuideClient {

  private final WebClient webClient;

  public GuideClient(@Value("${fastapi.guide.url}") String guideUrl) {
    this.webClient = WebClient.builder().baseUrl(guideUrl).build();
  }

  public GuideResponse guideImage(
      byte[] imageBytes,
      String filename,
      String mimeType,
      String message,
      String userId,
      String intent,
      String track,
      String medium,
      String requestId) {
    try {
      MultipartBodyBuilder b = new MultipartBodyBuilder();
      b.part(
              "file",
              new ByteArrayResource(imageBytes) {
                @Override
                public String getFilename() {
                  return filename != null ? filename : "upload";
                }
              })
          .contentType(
              MediaType.parseMediaType(mimeType != null ? mimeType : "application/octet-stream"));
      if (message != null) b.part("message", message);
      if (userId != null) b.part("user_id", userId);
      if (intent != null) b.part("intent", intent);
      if (track != null) b.part("track", track);
      if (medium != null) b.part("medium", medium);
      if (requestId != null) b.part("request_id", requestId);

      GuideResponse resp =
          webClient
              .post()
              .uri("/guide")
              .contentType(MediaType.MULTIPART_FORM_DATA)
              .body(BodyInserters.fromMultipartData(b.build()))
              .retrieve()
              .bodyToMono(GuideResponse.class)
              .timeout(Duration.ofSeconds(60)) // 코칭(LLM) 지연 고려
              // 연결/타임아웃 등 일시 오류만 재시도(같은 request_id → fastapi 가 부작용 디둡).
              // HTTP 4xx/5xx(WebClientResponseException)는 재시도하지 않는다.
              .retryWhen(
                  Retry.backoff(2, Duration.ofMillis(500))
                      .filter(ex -> !(ex instanceof WebClientResponseException)))
              .block();

      if (resp == null || resp.mode() == null) {
        throw new IllegalStateException("FastAPI guide 응답이 비었습니다.");
      }
      log.debug(
          "guide ok: mode={}, guideId={}, blocks={}",
          resp.mode(),
          resp.guideId(),
          resp.blocks() == null ? 0 : resp.blocks().size());
      return resp;
    } catch (Exception e) {
      log.error("FastAPI guide 호출 실패: bytes={}, error={}", imageBytes.length, e.getMessage());
      throw new RuntimeException("가이드 생성 실패: " + e.getMessage(), e);
    }
  }
}
