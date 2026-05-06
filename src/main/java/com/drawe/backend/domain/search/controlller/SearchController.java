package com.drawe.backend.domain.search.controlller;

import com.drawe.backend.domain.search.dto.SearchRequest;
import com.drawe.backend.domain.search.dto.SearchResponse;
import com.drawe.backend.domain.search.service.SearchService;
import com.drawe.backend.global.response.ApiResponse;
import com.drawe.backend.global.security.PrincipalDetails;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
@RequestMapping("/search")
@RequiredArgsConstructor
@Tag(name = "Search", description = "이미지 검색 API")
public class SearchController {

    private final SearchService searchService;

    @PostMapping("/images")
    @Operation(summary = "이미지 검색", description = "텍스트 쿼리로 유사한 이미지를 찾습니다.")
    public ApiResponse<SearchResponse> searchImages(
            @AuthenticationPrincipal PrincipalDetails principal,
            @Valid @RequestBody SearchRequest request
    ){
        log.info("검색 요청: userId={}, query='{}'",
                principal.getUser().getId(), request.query());
        SearchResponse response = searchService.search(request);
        return ApiResponse.success(response);
    }
}
