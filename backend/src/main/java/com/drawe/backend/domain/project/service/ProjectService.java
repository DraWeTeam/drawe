package com.drawe.backend.domain.project.service;

import com.drawe.backend.domain.ChatSession;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ProjectSort;
import com.drawe.backend.domain.enums.ProjectStatus;
import com.drawe.backend.domain.llm.repository.ChatSessionRepository;
import com.drawe.backend.domain.llm.repository.LlmMessageRepository;
import com.drawe.backend.domain.log.SearchLogRepository;
import com.drawe.backend.domain.project.dto.CreateProjectRequest;
import com.drawe.backend.domain.project.dto.KeywordClassification;
import com.drawe.backend.domain.project.dto.ProjectDetailResponse;
import com.drawe.backend.domain.project.dto.ProjectListItem;
import com.drawe.backend.domain.project.dto.ProjectListResponse;
import com.drawe.backend.domain.project.dto.UpdateProjectRequest;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ProjectService {

  private final ProjectRepository projectRepository;
  private final ProjectReferenceRepository projectReferenceRepository;
  private final ChatSessionRepository chatSessionRepository;
  private final LlmMessageRepository llmMessageRepository;
  private final SearchLogRepository searchLogRepository;
  private final ProjectKeywordService projectKeywordService;
  private final com.drawe.backend.domain.guide.repository.GuideRepository guideRepository;
  private final com.drawe.backend.domain.image.service.ImageUrlSigner imageUrlSigner;
  private final com.drawe.backend.domain.image.repository.ImageBlobRepository imageBlobRepository;

  /** 브라우저 노출용 서명 — s3:{key}→presigned, /images/{id}→HMAC, 절대·null 은 원본. */
  private String signed(String url) {
    return (url != null && imageUrlSigner != null) ? imageUrlSigner.sign(url) : url;
  }

  // 표지는 업로드 경로(/images/{blobId})만 허용. 임의 URL·서명 URL 은 거부.
  //   자릿수 1~18 로 제한 — Long 오버플로(NumberFormatException→500) 방지, 초과는 INVALID_INPUT(400).
  private static final java.util.regex.Pattern COVER_IMAGE_URL =
      java.util.regex.Pattern.compile("^/images/(\\d{1,18})$");

  /** 표지 소유권 검증(IDOR 방지) — 업로드 경로 형식 + 현재 사용자 소유 이미지여야 한다. */
  private void assertCoverImageOwned(User user, String coverUrl) {
    java.util.regex.Matcher m = COVER_IMAGE_URL.matcher(coverUrl);
    if (!m.matches()) {
      throw new CustomException(ErrorCode.INVALID_INPUT);
    }
    Long blobId = Long.valueOf(m.group(1));
    var blob =
        imageBlobRepository
            .findById(blobId)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    if (blob.getUser() == null || !blob.getUser().getId().equals(user.getId())) {
      throw new CustomException(ErrorCode.FORBIDDEN);
    }
  }

  @Transactional
  public ProjectDetailResponse create(User user, CreateProjectRequest request) {
    List<String> keywords = request.keywords() == null ? List.of() : request.keywords();
    // 백그라운드 분류 — 키워드에서 subject(필수)/mood/technique 를 뽑아 채운다(downstream: AI 색인·전역검색·어드민 유지).
    KeywordClassification cls = projectKeywordService.classify(keywords);

    Project project = new Project();
    project.setUser(user);
    project.setName(request.name());
    project.setKeywords(new ArrayList<>(keywords));
    project.setSubject(cls.subject());
    project.setTechnique(cls.technique());
    project.setMood(cls.mood());
    project.setDescription(request.description());
    project.setStatus(ProjectStatus.IN_PROGRESS);
    Project saved = projectRepository.save(project);
    return ProjectDetailResponse.from(
        saved, signed(saved.getCoverImageUrl()), Collections.emptyList());
  }

  @Transactional(readOnly = true)
  public ProjectListResponse getList(
      User user, String q, String statusParam, ProjectSort sort, int limit, int offset) {
    ProjectStatus status = parseStatus(statusParam);

    List<Project> projects = projectRepository.findPage(user, status, sort, q, limit, offset);
    long total = projectRepository.countPage(user, status, q);

    List<ProjectListItem> items =
        projects.stream()
            .map(
                p ->
                    ProjectListItem.of(
                        p,
                        projectReferenceRepository.countByProject(p),
                        signed(p.getCoverImageUrl())))
            .toList();

    boolean hasMore = (long) offset + items.size() < total;
    return new ProjectListResponse(items, total, hasMore);
  }

  @Transactional(readOnly = true)
  public ProjectDetailResponse getDetail(User user, Long projectId) {
    Project project = loadAuthorized(user, projectId);
    return ProjectDetailResponse.from(
        project, signed(project.getCoverImageUrl()), Collections.emptyList());
  }

  @Transactional
  public void update(User user, Long projectId, UpdateProjectRequest request) {
    Project project = loadAuthorized(user, projectId);
    if (request.name() != null) {
      project.setName(request.name());
    }
    if (request.subject() != null) {
      project.setSubject(request.subject());
    }
    if (request.technique() != null) {
      project.setTechnique(request.technique());
    }
    if (request.mood() != null) {
      project.setMood(request.mood());
    }
    if (request.keywords() != null) {
      project.setKeywords(request.keywords());
    }
    if (request.description() != null) {
      project.setDescription(request.description());
    }
    if (request.status() != null) {
      project.setStatus(parseStatusStrict(request.status()));
    }
    if (request.drawingUrl() != null) {
      project.setDrawingUrl(request.drawingUrl());
    }
    // 표지: 빈 문자열이면 제거(모달 X 버튼), 값이 있으면 교체. null 은 변경 없음.
    //   파일명·용량은 표지와 한 묶음 — 교체 시 함께 저장, 제거 시 함께 비움.
    if (request.coverImageUrl() != null) {
      boolean removing = request.coverImageUrl().isBlank();
      if (!removing) {
        assertCoverImageOwned(user, request.coverImageUrl());
      }
      project.setCoverImageUrl(removing ? null : request.coverImageUrl());
      project.setCoverImageName(
          removing || request.coverImageName() == null || request.coverImageName().isBlank()
              ? null
              : request.coverImageName());
      project.setCoverImageSize(removing ? null : request.coverImageSize());
    }
    if (request.detailAnswers() != null) {
      project.setDetailAnswers(request.detailAnswers());
    }
    // 프로젝트 완료 시 대표 이미지가 없으면 최근 가이드 업로드를 완성작 대표로 자동 지정한다.
    //   정본: '프로젝트 완료'는 별도 파일 업로드 없이 status=COMPLETED 만 보내고 완성작 갤러리에 담긴다.
    //   완성작 갤러리(findCompletedWithDrawing)는 drawingUrl 있는 것만 노출하므로 여기서 확보.
    if (project.getStatus() == ProjectStatus.COMPLETED
        && (project.getDrawingUrl() == null || project.getDrawingUrl().isBlank())) {
      guideRepository
          .findByUser_IdAndProject_IdOrderByCreatedAtDesc(user.getId(), projectId)
          .stream()
          .filter(g -> g.getUpload() != null)
          .findFirst()
          .ifPresent(g -> project.setDrawingUrl("/images/" + g.getUpload().getId()));
    }
  }

  @Transactional
  public void delete(User user, Long projectId) {
    Project project = loadAuthorized(user, projectId);
    List<ChatSession> sessions = chatSessionRepository.findByProject(project);
    for (ChatSession s : sessions) {
      llmMessageRepository.deleteByChatSession(s);
    }
    chatSessionRepository.deleteAll(sessions);
    projectReferenceRepository.deleteByProject(project);
    searchLogRepository.deleteByProject(project);
    projectRepository.delete(project);
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

  private ProjectStatus parseStatus(String statusParam) {
    if (statusParam == null || statusParam.isBlank()) {
      return null;
    }
    return parseStatusStrict(statusParam);
  }

  private ProjectStatus parseStatusStrict(String statusParam) {
    try {
      return ProjectStatus.valueOf(statusParam.toUpperCase());
    } catch (IllegalArgumentException e) {
      throw new CustomException(ErrorCode.INVALID_INPUT);
    }
  }
}
