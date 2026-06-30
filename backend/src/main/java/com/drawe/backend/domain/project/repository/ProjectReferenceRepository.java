package com.drawe.backend.domain.project.repository;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.ProjectReference;
import com.drawe.backend.domain.User;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectReferenceRepository extends JpaRepository<ProjectReference, Long> {

  long countByProject(Project project);

  boolean existsByProjectAndImage(Project project, Image image);

  void deleteByProject(Project project);

  /**
   * 레퍼런스 아카이브 — 한 유저의 모든 프로젝트 레퍼런스를 image 와 함께 한 번에 로드(N+1 방지). 호출 측이 project 별로 그룹핑한다. 프로젝트 최신순, 그
   * 안에서 추가 최신순(addedAt DESC).
   */
  @Query(
      "SELECT pr FROM ProjectReference pr "
          + "JOIN FETCH pr.image "
          + "JOIN FETCH pr.project p "
          + "WHERE p.user = :user "
          + "ORDER BY p.id DESC, pr.addedAt DESC")
  List<ProjectReference> findAllByUserWithImage(@Param("user") User user);

  /**
   * 전역 검색(REFERENCE scope, SCRUM-105) — 아카이브에 담긴 레퍼런스 중 키워드에 걸리는 것만 최신순.
   *
   * <p>레퍼런스는 고유 이름이 없어(스톡 이미지) <b>소속 프로젝트</b>(name/subject/technique/mood)와 <b>이미지 태그</b>
   * (subject/technique/mood)를 키워드 대상으로 삼는다. {@code ImageDraweTag} 는 {@code Image} 와 {@code @MapsId}
   * 1:1 이라 이미지당 최대 1행 → ad-hoc {@code LEFT JOIN ... ON} 으로 붙여도 행 중복이 없다(태그 없는 레퍼런스도 보존).
   *
   * <p>{@code kw} 는 호출 측이 {@code %소문자%} 형태로 만들어 넘긴다. to-one 만 fetch 하므로 페이징이 메모리에서 일어나지 않는다.
   */
  @Query(
      "SELECT pr FROM ProjectReference pr "
          + "JOIN FETCH pr.image i "
          + "JOIN FETCH pr.project p "
          + "LEFT JOIN ImageDraweTag t ON t.image = i "
          + "WHERE p.user = :user AND ("
          + "  LOWER(p.name) LIKE :kw OR LOWER(p.subject) LIKE :kw "
          + "  OR LOWER(p.technique) LIKE :kw OR LOWER(p.mood) LIKE :kw "
          + "  OR LOWER(t.subject) LIKE :kw OR LOWER(t.technique) LIKE :kw OR LOWER(t.mood) LIKE :kw) "
          + "ORDER BY pr.addedAt DESC")
  List<ProjectReference> searchByKeyword(
      @Param("user") User user, @Param("kw") String kw, Pageable pageable);
}
