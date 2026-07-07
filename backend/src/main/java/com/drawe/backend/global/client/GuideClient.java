package com.drawe.backend.global.client;

import com.drawe.backend.global.client.dto.GuideResponse;
import com.drawe.backend.global.client.dto.RerollResponse;
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
    // 생성 이미지(/generate-image PNG)는 수 MB라 WebClient 기본 인메모리 버퍼(256KB)를 초과한다.
    //   16MB 로 올려 byte[] 바디를 받는다(가이드 JSON 응답에는 영향 없음).
    this.webClient =
        WebClient.builder()
            .baseUrl(guideUrl)
            .codecs(c -> c.defaultCodecs().maxInMemorySize(16 * 1024 * 1024))
            .build();
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
      String projectId,
      String mood) {
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
      if (mood != null && !mood.isBlank()) {
        // 온보딩 무드 취향(user_pref_tags AXIS_MOOD, weight 내림차순) — fastapi 가 mood_map.yaml 로
        // persona 공간에 매핑해 추천에 soft boost 만. 없으면 미전송 → fastapi 랭킹 현행 동일.
        b.part("mood", mood);
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
   * 레퍼런스 재추천 — 축(sub_problem) + 이미 노출된 ref 배제목록을 guide 서비스 {@code POST /reroll} 로 보내 새 컷(+badge
   * 메타)을 받는다. LLM 미경유(참조 벡터검색만). adopt 와 달리 사용자 요청 즉답이라 실패는 예외로 올려 호출자(GuideService)가 매핑 → 프론트가 정직
   * 토스트 + 기존 표시 유지(silent 대체 금지).
   */
  public RerollResponse reroll(String subProblem, java.util.List<String> exclude) {
    try {
      MultipartBodyBuilder b = new MultipartBodyBuilder();
      b.part("sub_problem", subProblem);
      b.part("exclude", exclude == null ? "" : String.join(",", exclude));
      RerollResponse resp =
          webClient
              .post()
              .uri("/reroll")
              .contentType(MediaType.MULTIPART_FORM_DATA)
              .body(BodyInserters.fromMultipartData(b.build()))
              .retrieve()
              .bodyToMono(RerollResponse.class)
              .timeout(Duration.ofSeconds(20))
              .block();
      if (resp == null) {
        throw new IllegalStateException("FastAPI reroll 응답이 비었습니다.");
      }
      return resp;
    } catch (Exception e) {
      Throwable cause = org.springframework.core.NestedExceptionUtils.getMostSpecificCause(e);
      log.error(
          "FastAPI reroll 호출 실패: sub_problem={}, cause={}: {}",
          subProblem,
          cause.getClass().getSimpleName(),
          cause.getMessage());
      throw new RuntimeException("재추천 생성 실패: " + e.getMessage(), e);
    }
  }

  /**
   * 레퍼런스 생성 — concept 프롬프트를 guide 서비스 {@code POST /generate-image}(활성 provider=bedrock)로 보내 PNG
   * 바이트를 받는다. Bria 대체(2026-07 bedrock 전환). 생성 실패(502)·타임아웃은 예외로 올려 호출자가 매핑한다.
   */
  public byte[] generateImage(String prompt) {
    return webClient
        .post()
        .uri("/generate-image")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(Map.of("prompt", prompt))
        .retrieve()
        .bodyToMono(byte[].class)
        .timeout(Duration.ofSeconds(120))
        .block();
  }

  // 코퍼스 레퍼런스 인제스트 fetch 상한 — WebClient 인메모리 버퍼(16MB)와 동일 정책.
  private static final long MAX_REF_BYTES = 16L * 1024 * 1024;

  /**
   * 코퍼스 레퍼런스(§4) 원본 bytes 를 아카이브 인제스트용으로 가져온다. 안전판: (a) guide 프록시의 302 Location 이 신뢰 S3 호스트일 때만 추적,
   * (b) content-type image/* + 크기 상한 검증, (c) 실패·타임아웃은 예외로 올려 호출자 트랜잭션이 롤백되게 한다(고아 저장 방지 — 호출자는 이
   * fetch 성공 후에만 store/Image 를 만든다).
   *
   * @param refId 코퍼스 UUID (경로 주입 방지: '/'·'..' 불허)
   */
  public byte[] fetchReferenceBytes(String refId) {
    if (refId == null || refId.isBlank() || refId.contains("/") || refId.contains("..")) {
      throw new IllegalArgumentException("invalid refId");
    }
    // 1) guide 프록시(신뢰)에서 302 Location(presigned S3) 만 획득 — 리다이렉트 미추적.
    URI location =
        webClient
            .get()
            .uri(b -> b.path("/image/{id}").build(refId))
            .exchangeToMono(
                resp -> {
                  if (resp.statusCode().is3xxRedirection()) {
                    URI loc = resp.headers().asHttpHeaders().getLocation();
                    return resp.releaseBody().then(Mono.justOrEmpty(loc));
                  }
                  // 코퍼스는 항상 presigned 리다이렉트 → 그 외 응답은 인제스트 대상 아님.
                  return resp.releaseBody().then(Mono.empty());
                })
            .block(Duration.ofSeconds(10));
    if (location == null) {
      throw new IllegalStateException("코퍼스 레퍼런스 Location 없음: refId=" + refId);
    }
    // (a) 신뢰 호스트 한정 — presigned S3(*.amazonaws.com)만.
    String host = location.getHost();
    if (host == null || !host.toLowerCase().endsWith(".amazonaws.com")) {
      throw new SecurityException("신뢰하지 않는 리다이렉트 호스트: " + host);
    }
    // 2) presigned S3 에서 bytes — content-type image/* + 크기 상한(버퍼가 초과 시 예외).
    return webClient
        .get()
        .uri(location)
        .exchangeToMono(
            resp -> {
              if (!resp.statusCode().is2xxSuccessful()) {
                return resp.releaseBody()
                    .then(Mono.error(new IllegalStateException("S3 status " + resp.statusCode())));
              }
              HttpHeaders h = resp.headers().asHttpHeaders();
              MediaType ct = h.getContentType();
              if (ct == null || !"image".equalsIgnoreCase(ct.getType())) {
                return resp.releaseBody()
                    .then(Mono.error(new IllegalStateException("이미지 content-type 아님: " + ct)));
              }
              if (h.getContentLength() > MAX_REF_BYTES) {
                return resp.releaseBody()
                    .then(Mono.error(new IllegalStateException("크기 초과: " + h.getContentLength())));
              }
              return resp.bodyToMono(byte[].class);
            })
        .block(Duration.ofSeconds(15));
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
