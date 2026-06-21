package com.drawe.backend.domain.project.repository;

import static com.drawe.backend.domain.QProject.project;

import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ProjectSort;
import com.drawe.backend.domain.enums.ProjectStatus;
import com.querydsl.core.types.OrderSpecifier;
import com.querydsl.core.types.dsl.BooleanExpression;
import com.querydsl.jpa.impl.JPAQueryFactory;
import java.util.List;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
public class ProjectRepositoryImpl implements ProjectRepositoryCustom {

  private final JPAQueryFactory queryFactory;

  @Override
  public List<Project> findPage(
      User user, ProjectStatus statusOrNull, ProjectSort sort, int limit, int offset) {

    return queryFactory
        .selectFrom(project)
        .where(project.user.eq(user), statusEq(statusOrNull))
        .orderBy(getOrderSpecifier(sort), project.id.desc())
        .offset(offset)
        .limit(limit)
        .fetch();
  }

  private BooleanExpression statusEq(ProjectStatus status) {
    return status == null ? null : project.status.eq(status);
  }

  private OrderSpecifier<?> getOrderSpecifier(ProjectSort sort) {
    return switch (sort) {
      case RECENT -> project.updatedAt.desc();
      case CREATED -> project.createdAt.desc();
      case NAME -> project.name.asc();
    };
  }
}
