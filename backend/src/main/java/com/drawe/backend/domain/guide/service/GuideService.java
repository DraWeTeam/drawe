package com.drawe.backend.domain.guide.service;

import com.drawe.backend.domain.Guide;
import com.drawe.backend.domain.ImageBlob;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.guide.dto.GuideResult;
import com.drawe.backend.domain.guide.dto.ResolvedReference;
import com.drawe.backend.domain.guide.repository.GuideRepository;
import com.drawe.backend.domain.image.repository.ImageBlobRepository;
import com.drawe.backend.domain.image.service.ImageStorage;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.global.client.GuideClient;
import com.drawe.backend.global.client.dto.GuideResponse;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Slf4j
@Service
@RequiredArgsConstructor
public class GuideService {

  private static final int MAX_REFERENCES = 3;

  private final GuideClient guideClient;
  private final GuideRepository guideRepository;
  private final ProjectRepository projectRepository;
  private final ImageStorage imageStorage;
  private final ImageBlobRepository imageBlobRepository;

  /** 레퍼런스 이미지의 '브라우저 도달용' base(/image/{ref_id}). prod 도달성은 P5 인프라에서 확정. */
  @Value("${fastapi.guide.public-url}")
  private String guidePublicUrl;

  public GuideResult guide(
      User user,
      Long projectId,
      MultipartFile file,
      String message,
      String intent,
      String track,
      String medium,
      String idempotencyKey) {

    if (file == null || file.isEmpty()) {
      throw new CustomException(ErrorCode.INVALID_INPUT);
    }
    // 프로젝트 접근 권한 — 채팅과 동일 모델(NOT_FOUND / FORBIDDEN)
    Project project = loadProjectAuthorized(user, projectId);

    // 멱등 키: 클라이언트(Idempotency-Key) 우선, 없으면 생성.
    // 재시도 dedup 은 클라이언트가 같은 키를 다시 보낼 때 동작한다.
    String reqId =
        (idempotencyKey == null || idempotencyKey.isBlank())
            ? UUID.randomUUID().toString()
            : idempotencyKey.trim();

    // 이미 처리된 request_id → 저장된 가이드 재사용(재보강만). 업로드도 첫 호출에 이미 저장됨.
    Optional<Guide> existing = guideRepository.findByRequestId(reqId);
    if (existing.isPresent()) {
      return buildResult(existing.get().getPayload());
    }

    byte[] bytes;
    try {
      bytes = file.getBytes();
    } catch (IOException e) {
      throw new CustomException(ErrorCode.INVALID_INPUT);
    }

    // 느린 외부 호출(LLM 코칭) — 트랜잭션 밖에서 수행(DB 커넥션 장시간 점유 방지).
    GuideResponse resp;
    try {
      resp =
          guideClient.guideImage(
              bytes,
              file.getOriginalFilename(),
              file.getContentType(),
              message,
              String.valueOf(user.getId()), // growth 키 = user_id
              intent,
              track,
              medium,
              reqId);
    } catch (RuntimeException e) {
      log.error("guide 호출 실패: project={}, error={}", projectId, e.getMessage());
      throw new CustomException(ErrorCode.AI_SERVICE_ERROR);
    }

    // coach 모드만 영속(거절/재질문/리다이렉트는 히스토리에 남기지 않음).
    if ("coach".equals(resp.mode())) {
      persistGuide(reqId, resp, user, project, bytes, file.getContentType());
    }
    return buildResult(resp);
  }

  private void persistGuide(
      String reqId, GuideResponse resp, User user, Project project, byte[] bytes, String mime) {
    Guide g = new Guide();
    g.setRequestId(reqId);
    g.setGuideId(resp.guideId());
    g.setUser(user);
    g.setProject(project);
    g.setPrimaryFocus(resp.primaryFocus());
    g.setDegraded(resp.degraded());
    g.setPayload(resp);
    g.setUpload(storeUploadQuietly(user, bytes, mime)); // 원본 썸네일(선택). 실패 시 null.
    try {
      guideRepository.save(g);
    } catch (DataIntegrityViolationException dup) {
      // request_id UNIQUE 경합(동시 중복 제출) — 이미 저장됨. 무시.
      // (드물게 직전에 저장한 upload 가 고아로 남을 수 있음 — 영향 미미, 후속 정리 대상.)
      log.debug("guide 중복 저장 무시(request_id={})", reqId);
    }
  }

  /**
   * 업로드 원본을 image_blobs 에 저장하고 ImageBlob 프록시를 반환(히스토리 썸네일용).
   *
   * <p>가이드의 핵심 가치는 코칭이므로 저장 실패(검증/IO)는 치명적이지 않다 — null 을 반환해 upload_id 만 비우고
   * 가이드는 정상 반환한다. 이미 읽어둔 bytes 를 재사용(재읽기 없음).
   */
  private ImageBlob storeUploadQuietly(User user, byte[] bytes, String mime) {
    if (mime == null || mime.isBlank()) {
      return null;
    }
    try {
      ImageStorage.Stored stored = imageStorage.store(user, bytes, mime);
      return imageBlobRepository.getReferenceById(stored.id());
    } catch (RuntimeException e) {
      log.warn("업로드 원본 저장 실패(썸네일 생략): {}", e.getMessage());
      return null;
    }
  }

  /**
   * 프로젝트 내 '내 가이드' 히스토리. 채팅 재진입 시 가이드 카드를 복원하는 근거.
   *
   * <p>레포는 최신순(DESC)으로 주므로, 채팅 흐름과 맞게 오래된→최신 순으로 뒤집어 반환한다. payload(=저장
   * 시점 GuideResponse)로 {@link #buildResult}를 재실행해 레퍼런스 URL을 현재 기준으로 다시 보강한다.
   */
  public List<GuideResult> list(User user, Long projectId) {
    List<Guide> guides =
        guideRepository.findByUser_IdAndProject_IdOrderByCreatedAtDesc(user.getId(), projectId);
    List<GuideResult> out = new ArrayList<>(guides.size());
    for (int i = guides.size() - 1; i >= 0; i--) {
      out.add(buildResult(guides.get(i).getPayload()));
    }
    return out;
  }

  private GuideResult buildResult(GuideResponse resp) {
    return new GuideResult(resp, resolveReferences(resp));
  }

  /** 가이드 전체 블록의 reference_ids 를 등장 순서로 dedupe → 최대 3컷, 순번 + URL 보강. */
  private List<ResolvedReference> resolveReferences(GuideResponse resp) {
    List<ResolvedReference> out = new ArrayList<>();
    if (resp.blocks() == null) {
      return out;
    }
    LinkedHashSet<String> seen = new LinkedHashSet<>();
    for (GuideResponse.GuideBlock b : resp.blocks()) {
      if (b.referenceIds() == null) {
        continue;
      }
      for (String rid : b.referenceIds()) {
        if (rid != null && !rid.isBlank()) {
          seen.add(rid);
        }
      }
    }
    int ordinal = 1;
    for (String rid : seen) {
      if (ordinal > MAX_REFERENCES) {
        break;
      }
      out.add(new ResolvedReference(ordinal++, rid, referenceUrl(rid)));
    }
    return out;
  }

  private String referenceUrl(String refId) {
    String base =
        guidePublicUrl.endsWith("/")
            ? guidePublicUrl.substring(0, guidePublicUrl.length() - 1)
            : guidePublicUrl;
    return base + "/image/" + refId;
  }

  private Project loadProjectAuthorized(User user, Long projectId) {
    Project project =
        projectRepository
            .findById(projectId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (!project.getUser().getId().equals(user.getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    return project;
  }
}
