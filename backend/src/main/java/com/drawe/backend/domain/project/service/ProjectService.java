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
import com.drawe.backend.domain.project.dto.ProjectDetailResponse;
import com.drawe.backend.domain.project.dto.ProjectListItem;
import com.drawe.backend.domain.project.dto.ProjectListResponse;
import com.drawe.backend.domain.project.dto.UpdateProjectRequest;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
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

  @Transactional
  public ProjectDetailResponse create(User user, CreateProjectRequest request) {
    Project project = new Project();
    project.setUser(user);
    project.setName(request.name());
    project.setSubject(request.subject());
    project.setTechnique(request.technique());
    project.setMood(request.mood());
    project.setDescription(request.description());
    project.setStatus(ProjectStatus.IN_PROGRESS);
    Project saved = projectRepository.save(project);
    return ProjectDetailResponse.from(saved, Collections.emptyList());
  }

  @Transactional(readOnly = true)
  public ProjectListResponse getList(
      User user, String q, String statusParam, ProjectSort sort, int limit, int offset) {
    ProjectStatus status = parseStatus(statusParam);

    List<Project> projects = projectRepository.findPage(user, status, sort, q, limit, offset);
    long total = projectRepository.countPage(user, status, q);

    List<ProjectListItem> items =
        projects.stream()
            .map(p -> ProjectListItem.of(p, projectReferenceRepository.countByProject(p)))
            .toList();

    boolean hasMore = (long) offset + items.size() < total;
    return new ProjectListResponse(items, total, hasMore);
  }

  @Transactional(readOnly = true)
  public ProjectDetailResponse getDetail(User user, Long projectId) {
    Project project = loadAuthorized(user, projectId);
    return ProjectDetailResponse.from(project, Collections.emptyList());
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
    if (request.description() != null) {
      project.setDescription(request.description());
    }
    if (request.status() != null) {
      project.setStatus(parseStatusStrict(request.status()));
    }
    if (request.detailAnswers() != null) {
      project.setDetailAnswers(request.detailAnswers());
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
