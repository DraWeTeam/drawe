package com.drawe.backend.domain.search.controlller;

import com.drawe.backend.domain.enums.SearchScope;
import com.drawe.backend.domain.search.dto.GlobalSearchResponse;
import com.drawe.backend.domain.search.service.GlobalSearchService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 전역 검색(SearchModal) — 사용자 콘텐츠를 대상별로 텍스트 검색한다. SCRUM-105.
 *
 * <p>{@code GET /search}. 챗 의미검색({@code POST /search/images}, {@code SearchController})과 같은 {@code
 * /search} prefix 를 공유하지만 method+path 가 달라 충돌하지 않는다.
 */
@Slf4j
@RestController
@RequestMapping("/search")
@RequiredArgsConstructor
@Tag(name = "Search", description = "이미지 검색 API")
public class GlobalSearchController {

  private final GlobalSearchService globalSearchService;

  @GetMapping
  @Operation(summary = "전역 검색", description = "전체/프로젝트/레퍼런스/완성작 갤러리 대상으로 키워드 검색합니다.")
  public ApiResponse<GlobalSearchResponse> search(
      @AuthenticationPrincipal PrincipalDetails principal,
      @RequestParam(required = false) String q,
      @RequestParam(required = false, defaultValue = "ALL") String scope,
      @RequestParam(required = false, defaultValue = "10") int limit) {
    SearchScope parsed = SearchScope.from(scope);
    log.info(
        "전역 검색: userId={}, scope={}, q_length={}",
        principal.getUser().getId(),
        parsed,
        q == null ? 0 : q.length());
    return ApiResponse.success(globalSearchService.search(principal.getUser(), q, parsed, limit));
  }
}
