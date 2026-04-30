package com.drawe.backend.domain.project.repository;

import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.ProjectReference;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectReferenceRepository extends JpaRepository<ProjectReference, Long> {

  long countByProject(Project project);

  void deleteByProject(Project project);
}
