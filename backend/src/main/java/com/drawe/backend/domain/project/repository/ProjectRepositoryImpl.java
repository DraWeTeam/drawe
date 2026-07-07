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
      User user,
      ProjectStatus statusOrNull,
      ProjectSort sort,
      String keyword,
      int limit,
      int offset) {

    return queryFactory
        .selectFrom(project)
        .where(project.user.eq(user), statusEq(statusOrNull), searchContains(keyword))
        .orderBy(getOrderSpecifier(sort), project.id.desc())
        .offset(offset)
        .limit(limit)
        .fetch();
  }

  @Override
  public long countPage(User user, ProjectStatus statusOrNull, String keyword) {
    Long count =
        queryFactory
            .select(project.count())
            .from(project)
            .where(project.user.eq(user), statusEq(statusOrNull), searchContains(keyword))
            .fetchOne();
    return count == null ? 0 : count;
  }

  private BooleanExpression statusEq(ProjectStatus status) {
    return status == null ? null : project.status.eq(status);
  }

  // 검색어 부분일치(대소문자 무시) — name/subject/technique/mood. q 가 비면 null → where 에서 무시된다.
  // null 컬럼(subject/technique/mood)은 LIKE 가 매칭 안 함(결과 NULL) — 다른 절과 OR 라 안전.
  private BooleanExpression searchContains(String q) {
    if (q == null || q.isBlank()) {
      return null;
    }
    String kw = q.trim();
    return project
        .name
        .containsIgnoreCase(kw)
        .or(project.subject.containsIgnoreCase(kw))
        .or(project.technique.containsIgnoreCase(kw))
        .or(project.mood.containsIgnoreCase(kw));
  }

  private OrderSpecifier<?> getOrderSpecifier(ProjectSort sort) {
    return switch (sort) {
      case RECENT -> project.updatedAt.desc();
      case CREATED -> project.createdAt.desc();
      case NAME -> project.name.asc();
    };
  }
}
