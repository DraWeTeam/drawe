package com.drawe.backend.domain.guide.service;

import com.drawe.backend.domain.Guide;
import com.drawe.backend.domain.GuideFeedback;
import com.drawe.backend.domain.ImageBlob;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.FeedbackType;
import com.drawe.backend.domain.guide.dto.GuideResult;
import com.drawe.backend.domain.guide.dto.ResolvedReference;
import com.drawe.backend.domain.guide.repository.GuideFeedbackRepository;
import com.drawe.backend.domain.guide.repository.GuideRepository;
import com.drawe.backend.domain.image.repository.ImageBlobRepository;
import com.drawe.backend.domain.image.service.ImageStorage;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.global.client.GuideClient;
import com.drawe.backend.global.client.dto.GuideResponse;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Slf4j
@Service
@RequiredArgsConstructor
public class GuideService {

  private static final int MAX_REFERENCES = 3;

  private final GuideClient guideClient;
  private final GuideRepository guideRepository;
  private final GuideFeedbackRepository guideFeedbackRepository;
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
      return buildResult(
          existing.get().getPayload(), existing.get().getCreatedAt(), uploadUrl(existing.get()));
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
    String uploadUrl = null;
    if ("coach".equals(resp.mode())) {
      Guide saved = persistGuide(reqId, resp, user, project, bytes, file.getContentType());
      uploadUrl = saved != null ? uploadUrl(saved) : null;
    }
    return buildResult(resp, Instant.now(), uploadUrl);
  }

  private Guide persistGuide(
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
      return g;
    } catch (DataIntegrityViolationException dup) {
      // request_id UNIQUE 경합(동시 중복 제출) — 이미 저장됨. 무시.
      // (드물게 직전에 저장한 upload 가 고아로 남을 수 있음 — 영향 미미, 후속 정리 대상.)
      log.debug("guide 중복 저장 무시(request_id={})", reqId);
      return null;
    }
  }

  /**
   * 업로드 원본을 image_blobs 에 저장하고 ImageBlob 프록시를 반환(히스토리 썸네일용).
   *
   * <p>가이드의 핵심 가치는 코칭이므로 저장 실패(검증/IO)는 치명적이지 않다 — null 을 반환해 upload_id 만 비우고 가이드는 정상 반환한다. 이미 읽어둔
   * bytes 를 재사용(재읽기 없음).
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
   * <p>레포는 최신순(DESC)으로 주므로, 채팅 흐름과 맞게 오래된→최신 순으로 뒤집어 반환한다. payload(=저장 시점 GuideResponse)로 {@link
   * #buildResult}를 재실행해 레퍼런스 URL을 현재 기준으로 다시 보강한다.
   */
  @Transactional(readOnly = true)
  public List<GuideResult> list(User user, Long projectId) {
    List<Guide> guides =
        guideRepository.findByUser_IdAndProject_IdOrderByCreatedAtDesc(user.getId(), projectId);
    List<GuideResult> out = new ArrayList<>(guides.size());
    for (int i = guides.size() - 1; i >= 0; i--) {
      Guide g = guides.get(i);
      out.add(buildResult(g.getPayload(), g.getCreatedAt(), uploadUrl(g)));
    }
    return out;
  }

  /**
   * 가이드 내 레퍼런스 묶음 피드백(👍 liked / 👎 disliked). 그 가이드가 보여준 레퍼런스(최대 3컷)에 동일 이벤트를 adoption_log 로
   * 적재(guide 서비스 /adopt 경유). best-effort — 일부 실패해도 흐름 유지.
   */
  @Transactional(readOnly = true)
  public void adoptReferences(
      User user, Long projectId, String guideId, String event, List<String> referenceIds) {
    if (!"liked".equals(event) && !"disliked".equals(event)) {
      throw new CustomException(ErrorCode.INVALID_INPUT);
    }
    loadProjectAuthorized(user, projectId); // 프로젝트 접근 권한
    Guide g =
        guideRepository
            .findByGuideId(guideId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (!g.getUser().getId().equals(user.getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
    // 대상: 클라이언트가 *실제로 본* 레퍼런스(새로고침 묶음 포함). 단 가이드 페이로드의 ref 풀에 든
    // 것만 허용(임의 ref 적재 차단). 없으면 top-3 로 폴백.
    List<String> targets;
    if (referenceIds != null && !referenceIds.isEmpty()) {
      Set<String> pool = allReferenceIds(g.getPayload());
      targets = referenceIds.stream().filter(pool::contains).distinct().toList();
    } else {
      targets = resolveReferences(g.getPayload()).stream().map(ResolvedReference::refId).toList();
    }
    for (String refId : targets) {
      guideClient.adopt(guideId, refId, event);
    }
  }

  /** 가이드 페이로드 전체 블록의 reference_ids 합집합(중복 제거). 피드백 대상 화이트리스트. */
  private Set<String> allReferenceIds(GuideResponse resp) {
    Set<String> out = new LinkedHashSet<>();
    if (resp.blocks() != null) {
      for (GuideResponse.GuideBlock b : resp.blocks()) {
        if (b.referenceIds() != null) {
          for (String rid : b.referenceIds()) {
            if (rid != null && !rid.isBlank()) {
              out.add(rid);
            }
          }
        }
      }
    }
    return out;
  }

  /**
   * 가이드 전체 피드백(👍 like / 👎 dislike / 해제 null) — adoption_log 와 분리된 guide_feedback 에 적재. 사용자별
   * 1행(있으면 갱신, 없으면 생성), null/빈 값이면 토글 해제(행 삭제). ImageFeedbackService 와 동일 패턴.
   */
  @Transactional
  public void setGuideFeedback(User user, Long projectId, String guideId, String feedback) {
    loadProjectAuthorized(user, projectId); // 프로젝트 접근 권한
    Guide g =
        guideRepository
            .findByGuideId(guideId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (!g.getUser().getId().equals(user.getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }

    // 토글 해제: 기존 피드백 있으면 삭제하고 종료.
    if (feedback == null || feedback.isBlank()) {
      guideFeedbackRepository
          .findByUserAndGuide(user, g)
          .ifPresent(guideFeedbackRepository::delete);
      return;
    }

    FeedbackType type;
    if ("like".equalsIgnoreCase(feedback)) {
      type = FeedbackType.LIKE;
    } else if ("dislike".equalsIgnoreCase(feedback)) {
      type = FeedbackType.DISLIKE;
    } else {
      throw new CustomException(ErrorCode.INVALID_INPUT);
    }

    // 있으면 갱신, 없으면 생성(업서트). (user_id, guide_id) UNIQUE 로 사용자별 1행 보장.
    GuideFeedback gf =
        guideFeedbackRepository
            .findByUserAndGuide(user, g)
            .orElseGet(
                () -> {
                  GuideFeedback f = new GuideFeedback();
                  f.setUser(user);
                  f.setGuide(g);
                  return f;
                });
    gf.setFeedback(type);
    guideFeedbackRepository.save(gf);
  }

  private GuideResult buildResult(GuideResponse resp, Instant createdAt, String uploadUrl) {
    return new GuideResult(resp, resolveReferences(resp), createdAt, uploadUrl);
  }

  /** 저장된 업로드 원본의 internal URL(/images/{id}). 없으면 null. 채팅 이미지와 동일 서빙 경로. */
  private String uploadUrl(Guide g) {
    return g.getUpload() != null ? "/images/" + g.getUpload().getId() : null;
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
