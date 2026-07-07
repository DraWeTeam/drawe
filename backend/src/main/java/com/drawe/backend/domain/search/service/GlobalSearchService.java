package com.drawe.backend.domain.search.service;

import com.drawe.backend.domain.Image;
import com.drawe.backend.domain.Project;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.enums.ProjectSort;
import com.drawe.backend.domain.enums.ProjectStatus;
import com.drawe.backend.domain.enums.SearchScope;
import com.drawe.backend.domain.project.repository.ProjectReferenceRepository;
import com.drawe.backend.domain.project.repository.ProjectRepository;
import com.drawe.backend.domain.search.dto.GlobalSearchResponse;
import com.drawe.backend.domain.search.dto.GlobalSearchResponse.CompletedHit;
import com.drawe.backend.domain.search.dto.GlobalSearchResponse.ProjectHit;
import com.drawe.backend.domain.search.dto.GlobalSearchResponse.ReferenceHit;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 전역 검색(SearchModal) — 사용자 본인 콘텐츠를 대상별(전체/프로젝트/레퍼런스/완성작 갤러리) 텍스트 검색한다. SCRUM-105.
 *
 * <p>챗의 {@link SearchService}(CLIP·Pinecone 의미검색)와는 별개 경로다. 여기선 MySQL 부분일치만 한다.
 *
 * <p>PROJECT 는 기존 {@link ProjectRepository#findPage}(QueryDSL) 를 재사용해 {@code GET /projects?q=} 와 동일
 * 매칭 규칙을 보장한다. REFERENCE/COMPLETED 는 아카이브(레퍼런스 아카이브 / 완성작 갤러리)에 담긴 것을 대상으로 한다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GlobalSearchService {

  private final ProjectRepository projectRepository;
  private final ProjectReferenceRepository projectReferenceRepository;
  private final com.drawe.backend.domain.image.service.ImageUrlSigner imageUrlSigner;

  /** 브라우저 노출용 서명 — s3:{key}→presigned, /images/{id}→HMAC, 절대(시드)·null 은 원본. */
  private String signed(String url) {
    return (url != null && imageUrlSigner != null) ? imageUrlSigner.sign(url) : url;
  }

  /** scope=ALL 일 때 타입별 노출 상한(모달을 간결히). */
  private static final int ALL_PER_TYPE = 5;

  /** 특정 scope 의 limit 상한(과도한 페이로드 방지). */
  private static final int MAX_LIMIT = 50;

  public GlobalSearchResponse search(User user, String q, SearchScope scope, int limit) {
    String kw = q == null ? "" : q.trim();
    if (kw.isEmpty()) {
      return GlobalSearchResponse.empty();
    }
    SearchScope s = scope == null ? SearchScope.ALL : scope;
    int cap = s == SearchScope.ALL ? ALL_PER_TYPE : Math.min(Math.max(limit, 1), MAX_LIMIT);
    String like = "%" + kw.toLowerCase() + "%";

    List<ProjectHit> projects =
        wants(s, SearchScope.PROJECT) ? searchProjects(user, kw, cap) : List.of();
    List<ReferenceHit> references =
        wants(s, SearchScope.REFERENCE) ? searchReferences(user, like, cap) : List.of();
    List<CompletedHit> completed =
        wants(s, SearchScope.COMPLETED) ? searchCompleted(user, like, cap) : List.of();

    return new GlobalSearchResponse(projects, references, completed);
  }

  private static boolean wants(SearchScope requested, SearchScope type) {
    return requested == SearchScope.ALL || requested == type;
  }

  /** 프로젝트 — 기존 findPage 재사용(name/subject/technique/mood 부분일치). */
  private List<ProjectHit> searchProjects(User user, String kw, int cap) {
    return projectRepository.findPage(user, null, ProjectSort.RECENT, kw, cap, 0).stream()
        .map(
            p ->
                new ProjectHit(
                    p.getId(),
                    p.getName(),
                    p.getTechnique(),
                    p.getStatus().name().toLowerCase(),
                    p.getUpdatedAt()))
        .toList();
  }

  /** 레퍼런스 아카이브 — 소속 프로젝트 + 이미지 태그 키워드 매칭. */
  private List<ReferenceHit> searchReferences(User user, String like, int cap) {
    return projectReferenceRepository.searchByKeyword(user, like, PageRequest.of(0, cap)).stream()
        .map(
            pr -> {
              Image img = pr.getImage();
              Project p = pr.getProject();
              return new ReferenceHit(img.getId(), signed(img.getUrl()), p.getId(), p.getName());
            })
        .toList();
  }

  /** 완성작 갤러리 — 완성 처리된 프로젝트(drawingUrl) 키워드 매칭. */
  private List<CompletedHit> searchCompleted(User user, String like, int cap) {
    return projectRepository
        .searchCompleted(user, ProjectStatus.COMPLETED, like, PageRequest.of(0, cap))
        .stream()
        .map(
            p ->
                new CompletedHit(
                    p.getId(), p.getName(), signed(p.getDrawingUrl()), p.getUpdatedAt()))
        .toList();
  }
}
