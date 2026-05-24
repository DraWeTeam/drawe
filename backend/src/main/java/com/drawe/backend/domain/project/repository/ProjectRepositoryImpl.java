package com.drawe.backend.domain.project.repository;

import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ProjectStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import java.util.List;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
public class ProjectRepositoryImpl implements ProjectRepositoryCustom {

  private final EntityManager em;

  @Override
  public List<Project> findPage(User user, ProjectStatus statusOrNull, int limit, int offset) {
    String jpql =
        statusOrNull == null
            ? "SELECT p FROM Project p WHERE p.user = :user ORDER BY p.createdAt DESC"
            : "SELECT p FROM Project p WHERE p.user = :user AND p.status = :status "
                + "ORDER BY p.createdAt DESC";

    TypedQuery<Project> query = em.createQuery(jpql, Project.class).setParameter("user", user);
    if (statusOrNull != null) {
      query.setParameter("status", statusOrNull);
    }
    return query.setFirstResult(offset).setMaxResults(limit).getResultList();
  }
}
