package com.drawe.backend.global.client;

import com.drawe.backend.global.client.dto.GuideResponse;
import java.net.URI;
import java.time.Duration;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

/**
 * 이미지 가이딩 전용 FastAPI 클라이언트.
 *
 * <p>embed 와 *별도 ECS 서비스*(Service Connect: fastapi-guide.drawe-{env}.local:8000)라 {@code
 * ${fastapi.guide.url}} 를 따로 쓴다. /guide 계약: multipart/form-data, file field name = "file".
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
      String requestId,
      String projectId) {
    try {
      MultipartBodyBuilder b = new MultipartBodyBuilder();
      b.part("file", new ByteArrayResource(imageBytes))
          .filename(filename != null ? filename : "upload")
          .contentType(
              MediaType.parseMediaType(mimeType != null ? mimeType : "application/octet-stream"));
      if (message != null) {
        b.part("message", message);
      }
      if (userId != null) {
        b.part("user_id", userId);
      }
      if (intent != null) {
        b.part("intent", intent);
      }
      if (track != null) {
        b.part("track", track);
      }
      if (medium != null) {
        b.part("medium", medium);
      }
      if (requestId != null) {
        b.part("request_id", requestId);
      }
      if (projectId != null) {
        b.part("project_id", projectId); // growth 프로젝트 스코프 키(fastapi practice_log)
      }

      GuideResponse resp =
          webClient
              .post()
              .uri("/guide")
              .contentType(MediaType.MULTIPART_FORM_DATA)
              .body(BodyInserters.fromMultipartData(b.build()))
              .retrieve()
              .bodyToMono(GuideResponse.class)
              // reasoning LLM(grok ×2) + 손 VLM(Gemini) 순차 호출의 실측 지연에 맞춘다.
              // 이전 60s 는 정상 응답도 타임아웃 → 재시도 폭주를 유발했다.
              .timeout(Duration.ofSeconds(150))
              // 연결 establishment 실패만 재시도(같은 request_id → fastapi 가 부작용 디둡).
              // HTTP 4xx/5xx(WebClientResponseException)와 읽기 타임아웃(TimeoutException)은
              // 재시도하지 않는다 — 느린(정상) 파이프라인을 재시도하면 시간만 2배로 낭비하고
              // guide 서비스 부하만 늘려 연쇄 타임아웃을 키운다.
              .retryWhen(
                  Retry.backoff(2, Duration.ofMillis(500))
                      .filter(
                          ex ->
                              !(ex instanceof WebClientResponseException)
                                  && !(ex instanceof java.util.concurrent.TimeoutException)))
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
      // 근본 원인을 함께 남긴다 — e.getMessage() 만으로는 "Retries exhausted" 래퍼만 보여
      // 타임아웃인지 연결 거부인지 구분이 안 된다(장애 분류 불가).
      Throwable cause = org.springframework.core.NestedExceptionUtils.getMostSpecificCause(e);
      log.error(
          "FastAPI guide 호출 실패: bytes={}, error={}, cause={}: {}",
          imageBytes.length,
          e.getMessage(),
          cause.getClass().getSimpleName(),
          cause.getMessage());
      throw new RuntimeException("가이드 생성 실패: " + e.getMessage(), e);
    }
  }

  /**
   * 레퍼런스 피드백(liked/disliked 등)을 guide 서비스 {@code POST /adopt} 로 전달 → adoption_log 적재.
   *
   * <p>persona/source_type 은 guide 서비스가 reference_images·직전 'shown' 행에서 보강하므로 보내지 않는다. 피드백 적재 실패는
   * 사용자 흐름에 치명적이지 않으므로 예외를 삼키고 로그만 남긴다(best-effort).
   */
  public void adopt(String guideId, String referenceId, String event) {
    try {
      webClient
          .post()
          .uri("/adopt")
          .contentType(MediaType.APPLICATION_JSON)
          .bodyValue(Map.of("guide_id", guideId, "reference_id", referenceId, "event", event))
          .retrieve()
          .toBodilessEntity()
          .timeout(Duration.ofSeconds(5))
          .block();
    } catch (Exception e) {
      log.warn(
          "guide /adopt 실패(무시): ref={}, event={}, error={}", referenceId, event, e.getMessage());
    }
  }

  /**
   * 가이드 자산 프록시. 내부 guide 서비스의 {@code path}(예: {@code /image/<uuid>}, {@code /guide-asset/...})로 GET
   * 하여 응답을 그대로 흘려보낸다. WebClient 는 리다이렉트를 따라가지 않으므로(기본값) guide 의 302(presigned S3)를 잡아 그대로 브라우저에
   * 반환한다 — presigned 는 만료가 있어 캐시 금지(no-store). 인라인 SVG 등 2xx 본문은 Content-Type 과 함께 전달한다. 실패는 502 로
   * 매핑하여 이미지 태그가 깨진 이미지로 자연 degrade 하게 둔다.
   */
  public ResponseEntity<byte[]> fetchAsset(String path) {
    if (path == null || path.contains("..")) {
      return ResponseEntity.badRequest().build();
    }
    try {
      return webClient
          .get()
          .uri(uriBuilder -> uriBuilder.path(path).build())
          .exchangeToMono(
              resp -> {
                HttpStatusCode status = resp.statusCode();
                HttpHeaders headers = resp.headers().asHttpHeaders();
                URI location = headers.getLocation();
                if (status.is3xxRedirection() && location != null) {
                  return resp.releaseBody()
                      .then(
                          Mono.fromSupplier(
                              () ->
                                  ResponseEntity.status(HttpStatus.FOUND)
                                      .location(location)
                                      .header(HttpHeaders.CACHE_CONTROL, "no-store")
                                      .<byte[]>build()));
                }
                MediaType contentType = headers.getContentType();
                return resp.bodyToMono(byte[].class)
                    .defaultIfEmpty(new byte[0])
                    .map(
                        body ->
                            ResponseEntity.status(status)
                                .contentType(
                                    contentType != null
                                        ? contentType
                                        : MediaType.APPLICATION_OCTET_STREAM)
                                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300")
                                .body(body));
              })
          .timeout(Duration.ofSeconds(10))
          .block();
    } catch (Exception e) {
      log.warn("guide 자산 프록시 실패: path={}, error={}", path, e.getMessage());
      return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
    }
  }
}
