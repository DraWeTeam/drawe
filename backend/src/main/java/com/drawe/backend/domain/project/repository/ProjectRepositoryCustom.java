package com.drawe.backend.domain.project.repository;

import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ProjectSort;
import com.drawe.backend.domain.enums.ProjectStatus;
import java.util.List;

public interface ProjectRepositoryCustom {

  /**
   * 프로젝트 페이지 조회 — user 필수, status·q 선택. q 가 있으면 name/subject/technique/mood 부분일치(대소문자 무시)로 필터하고,
   * sort 로 정렬한다.
   */
  List<Project> findPage(
      User user,
      ProjectStatus statusOrNull,
      ProjectSort sort,
      String keyword,
      int limit,
      int offset);

  /** {@link #findPage} 와 동일 필터(status·q)의 전체 건수 — total/hasMore 계산용. */
  long countPage(User user, ProjectStatus statusOrNull, String keyword);
}
