package com.drawe.backend.domain.project.repository;

import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ProjectStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectRepository extends JpaRepository<Project, Long>, ProjectRepositoryCustom {

  long countByUser(User user);

  long countByUserAndStatus(User user, ProjectStatus status);

  /**
   * 완성작 갤러리 — 내 프로젝트 중 완성(COMPLETED) 처리됐고 완성 그림(drawingUrl)이 있는 것만 최신순. updatedAt 이 비어있을 수 있어 id 보조
   * 정렬.
   */
  @Query(
      "SELECT p FROM Project p "
          + "WHERE p.user = :user AND p.status = :status AND p.drawingUrl IS NOT NULL "
          + "ORDER BY p.updatedAt DESC, p.id DESC")
  Page<Project> findCompletedWithDrawing(
      @Param("user") User user, @Param("status") ProjectStatus status, Pageable pageable);
}
