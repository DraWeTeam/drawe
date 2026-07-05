package com.drawe.backend.domain.image.service;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.analytics.AnalyticsEventType;
import com.drawe.backend.domain.analytics.service.AnalyticsEventService;
import com.drawe.backend.domain.enums.ImageSource;
import com.drawe.backend.domain.image.event.AiImageCreatedEvent;
import com.drawe.backend.domain.image.repository.ImageRepository;
import com.drawe.backend.domain.llm.service.PromptTranslator;
import com.drawe.backend.global.client.GuideClient;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.util.HashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이미지를 생성하고, 결과 바이트를 ImageStorage (DB) 에 영구 저장한 뒤 Image 엔티티를 만들어 반환한다.
 *
 * <p>생성기 = guide 서비스 {@code POST /generate-image}(활성 provider, 배포 bedrock). 반환 바이트를 즉시 DB 로 옮긴다.
 * (2026-07 Bria → Bedrock 전환.)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ImageGenerationService {

  private static final String DEFAULT_MIME = "image/png";

  private final GuideClient guideClient;
  private final ImageStorage imageStorage;
  private final ImageRepository imageRepository;
  private final PromptTranslator promptTranslator;
  private final ApplicationEventPublisher eventPublisher;
  private final AnalyticsEventService analyticsEventService;

  @Transactional
  public Image generate(User user, String prompt, Project project) {
    if (prompt == null || prompt.isBlank()) {
      throw new CustomException(ErrorCode.INVALID_INPUT);
    }

    // prompt 가 사용자 한국어 원문일 수도 있어 길이만 기록. 변환된 영문은 아래 PromptTranslator 로그에서 확인.
    log.info("AI 이미지 생성 요청: user={}, prompt_length={}", user.getId(), prompt.length());
    String englishPrompt = promptTranslator.translate(user, prompt, project);

    byte[] bytes;
    try {
      bytes = guideClient.generateImage(englishPrompt); // bedrock(활성 provider) PNG 바이트
    } catch (Exception e) {
      log.error("bedrock 이미지 생성 실패: error_class={}", e.getClass().getSimpleName());
      throw new CustomException(ErrorCode.AI_SERVICE_ERROR);
    }

    if (bytes == null || bytes.length == 0) {
      log.error("bedrock 이미지가 비어있음: prompt_length={}", englishPrompt.length());
      throw new CustomException(ErrorCode.AI_SERVICE_ERROR);
    }

    ImageStorage.Stored stored = imageStorage.store(user, bytes, DEFAULT_MIME);

    Image image = new Image();
    image.setSource(ImageSource.AI);
    image.setUrl(stored.url());
    image.setPrompt(englishPrompt);
    image.setCreatedBy(user);
    Image saved = imageRepository.save(image);

    // ID가 확정된 뒤 sourceId를 "ai_<id>" 컨벤션으로 채운다.
    // Pinecone vector id로도 사용되며, SearchService가 이 값으로 MySQL을 조회한다.
    saved.setSourceId("ai_" + saved.getId());
    saved = imageRepository.save(saved);

    log.info(
        "AI 이미지 저장 완료: imageId={}, blobId={}, url={}", saved.getId(), stored.id(), stored.url());

    // 일별 Bria 호출 수 집계용 이벤트 (images 테이블엔 created_at이 없음). 원문 프롬프트는 PII라 길이만 기록.
    // track()은 REQUIRES_NEW + fail-safe라 여기서 실패해도 이미지 생성 트랜잭션엔 영향 없음.
    Map<String, Object> genPayload = new HashMap<>();
    genPayload.put("image_id", saved.getId());
    genPayload.put("prompt_length", prompt.length());
    analyticsEventService.track(AnalyticsEventType.IMAGE_GENERATED, user, null, genPayload);

    // 트랜잭션 commit 후 비동기로 CLIP 임베딩 → Pinecone 적재.
    // 직접 호출하지 않고 이벤트로 띄우는 이유: @Async 비동기 스레드는 자기만의 TX 를 새로 시작하므로
    // 호출 측 commit 전이라면 새 행을 못 본다. AiImageIndexService 가 AFTER_COMMIT 단계에서 수신.
    eventPublisher.publishEvent(
        new AiImageCreatedEvent(saved.getId(), bytes, DEFAULT_MIME, project));

    return saved;
  }
}
