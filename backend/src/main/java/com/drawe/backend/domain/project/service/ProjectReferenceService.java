package com.drawe.backend.domain.project.service;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.ProjectReference;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.collection.service.CollectionAutoClassifyService;
import com.drawe.backend.domain.enums.ImageSource;
import com.drawe.backend.domain.image.repository.ImageRepository;
import com.drawe.backend.domain.image.service.ImageStorage;
import com.drawe.backend.domain.project.dto.ReferenceIngestRequest;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.global.client.GuideClient;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 레퍼런스 아카이브 적재 — "저장" 버튼이 이미지를 project_references 에 담는다(아카이브 페이지의 소스). */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectReferenceService {

  private static final String REF_MIME = "image/png";

  private final ProjectRepository projectRepository;
  private final ImageRepository imageRepository;
  private final ProjectReferenceRepository projectReferenceRepository;
  private final GuideClient guideClient;
  private final ImageStorage imageStorage;
  private final com.drawe.backend.domain.image.service.ImageUrlSigner imageUrlSigner;
  private final CollectionAutoClassifyService collectionAutoClassifyService;

  /** 브라우저 노출용 서명 — s3:{key}→presigned, /images/{id}→HMAC, 절대(시드)·null 은 원본. */
  private String signed(String url) {
    return (url != null && imageUrlSigner != null) ? imageUrlSigner.sign(url) : url;
  }

  /** 이미지를 프로젝트 레퍼런스로 저장. (project_id, image_id) unique 제약상 멱등하게 동작한다. */
  @Transactional
  public void addReference(User user, Long projectId, Long imageId) {
    Project project = loadAuthorized(user, projectId);

    Image image =
        imageRepository
            .findById(imageId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));

    if (projectReferenceRepository.existsByProjectAndImage(project, image)) {
      log.debug("이미 저장된 레퍼런스: projectId={}, imageId={}", projectId, imageId);
      return;
    }

    ProjectReference ref = new ProjectReference();
    ref.setProject(project);
    ref.setImage(image);
    projectReferenceRepository.save(ref);
    log.info("레퍼런스 저장: userId={}, projectId={}, imageId={}", user.getId(), projectId, imageId);
  }

  /**
   * 가이드 §4 코퍼스 레퍼런스(UUID)를 아카이브로 인제스트 — 원본 bytes fetch → DB 저장 → Image(GUIDE_REF) →
   * ProjectReference. 멱등: 같은 코퍼스 ref 는 (source=GUIDE_REF, sourceId=refId) 로 기존 Image 재사용(재-fetch 안
   * 함), ProjectReference 도 중복 무해. 저장 순서상 fetch(외부, 무-DB) 실패 시 아무 것도 쓰지 않고, store/Image/PR 은 한
   * 트랜잭션이라 이후 실패 시 blob 포함 전부 롤백된다.
   */
  @Transactional
  public Map<String, Object> ingestReference(
      User user, Long projectId, ReferenceIngestRequest req) {
    Project project = loadAuthorized(user, projectId);
    String refId = req.refId();
    if (refId == null || refId.isBlank()) {
      throw new CustomException(ErrorCode.INVALID_INPUT);
    }

    Image image =
        imageRepository
            .findFirstBySourceAndSourceId(ImageSource.GUIDE_REF, refId)
            .orElseGet(() -> ingestNew(user, req));

    if (!projectReferenceRepository.existsByProjectAndImage(project, image)) {
      ProjectReference ref = new ProjectReference();
      ref.setProject(project);
      ref.setImage(image);
      projectReferenceRepository.save(ref);
      log.info(
          "코퍼스 레퍼런스 아카이브: userId={}, projectId={}, imageId={}, refId={}",
          user.getId(),
          projectId,
          image.getId(),
          refId);
    }

    // 레벨2 자동 분류 — 가이드 축(sub_problem)을 알면 그 축 컬렉션에, 모르면 미분류에 담는다.
    //   기존 project_references 적재(위)는 그대로 두고 아카이브 컬렉션에 '추가로' 배치한다(멱등). 검색/보드 무영향.
    collectionAutoClassifyService.classifyByAxis(user, image, req.axis());

    return Map.of("imageId", image.getId(), "url", signed(image.getUrl()));
  }

  /** 신규 인제스트 — bytes fetch(외부) 후에만 store/Image 를 만든다(실패 시 고아 없음). */
  private Image ingestNew(User user, ReferenceIngestRequest req) {
    byte[] bytes;
    try {
      bytes = guideClient.fetchReferenceBytes(req.refId());
    } catch (Exception e) {
      log.error("코퍼스 레퍼런스 fetch 실패: refId={}, error={}", req.refId(), e.getClass().getSimpleName());
      throw new CustomException(ErrorCode.REFERENCE_INGEST_FAILED);
    }
    if (bytes == null || bytes.length == 0) {
      throw new CustomException(ErrorCode.REFERENCE_INGEST_FAILED);
    }
    ImageStorage.Stored stored = imageStorage.store(user, bytes, REF_MIME);
    Image image = new Image();
    image.setSource(ImageSource.GUIDE_REF);
    image.setSourceId(req.refId());
    image.setUrl(stored.url());
    image.setCreatedBy(user);
    image.setRawTags(buildRawTags(req));
    return imageRepository.save(image);
  }

  /** 코퍼스 meta(sourceType/region/category/personas) 를 rawTags 로 보존 — 보드 아카이브 키워드 검색에도 걸린다. */
  private List<String> buildRawTags(ReferenceIngestRequest req) {
    LinkedHashSet<String> tags = new LinkedHashSet<>();
    if (req.sourceType() != null && !req.sourceType().isBlank()) {
      tags.add(req.sourceType());
    }
    if (req.region() != null && !req.region().isBlank()) {
      tags.add(req.region());
    }
    if (req.category() != null && !req.category().isBlank()) {
      tags.add(req.category());
    }
    if (req.personas() != null) {
      for (String pna : req.personas()) {
        if (pna != null && !pna.isBlank()) {
          tags.add(pna);
        }
      }
    }
    return tags.isEmpty() ? null : new ArrayList<>(tags);
  }

  private Project loadAuthorized(User user, Long projectId) {
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
