package com.drawe.backend.domain.search;

import static org.assertj.core.api.Assertions.assertThat;

import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.ProjectReference;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ProjectStatus;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.global.config.QuerydslConfig;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.PageRequest;

/**
 * SCRUM-105 전역 검색 신규 JPQL 검증 — 실제 MySQL 스키마에 대해 {@code searchCompleted}/{@code searchByKeyword}
 * 쿼리가 파싱·실행되는지 확인한다(레퍼런스 ad-hoc {@code LEFT JOIN ... ON} 포함). 트랜잭션 롤백이라 DB 오염 없음.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(QuerydslConfig.class)
class GlobalSearchRepositoryTest {

  @Autowired private TestEntityManager em;
  @Autowired private ProjectRepository projectRepository;
  @Autowired private ProjectReferenceRepository projectReferenceRepository;

  private User persistUser(String email) {
    return em.persist(User.builder().email(email).nickname("gs").build());
  }

  @Test
  void searchCompleted_파싱_실행된다() {
    User u = persistUser("gs-completed@test.com");
    em.flush();

    List<Project> r =
        projectRepository.searchCompleted(
            u, ProjectStatus.COMPLETED, "%존재하지않는키워드%", PageRequest.of(0, 5));

    assertThat(r).isEmpty();
  }

  @Test
  void searchByKeyword_레퍼런스_adhoc조인_파싱_실행된다() {
    User u = persistUser("gs-ref@test.com");
    em.flush();

    List<ProjectReference> r =
        projectReferenceRepository.searchByKeyword(u, "%존재하지않는키워드%", PageRequest.of(0, 5));

    assertThat(r).isEmpty();
  }
}
