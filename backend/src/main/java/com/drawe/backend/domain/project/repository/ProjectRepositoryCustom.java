package com.drawe.backend.domain.project.repository;

import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ProjectSort;
import com.drawe.backend.domain.enums.ProjectStatus;
import java.util.List;

public interface ProjectRepositoryCustom {

  List<Project> findPage(
      User user, ProjectStatus statusOrNull, ProjectSort sort, int limit, int offset);
}
