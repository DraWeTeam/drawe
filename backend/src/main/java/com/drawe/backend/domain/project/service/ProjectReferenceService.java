package com.drawe.backend.domain.project.service;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.ProjectReference;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.image.repository.ImageRepository;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 레퍼런스 아카이브 적재 — "저장" 버튼이 이미지를 project_references 에 담는다(아카이브 페이지의 소스). */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectReferenceService {

  private final ProjectRepository projectRepository;
  private final ImageRepository imageRepository;
  private final ProjectReferenceRepository projectReferenceRepository;

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
