package com.drawe.backend.domain.reference.service;

import com.drawe.backend.domain.reference.ReferenceBoardImpression;
import com.drawe.backend.domain.reference.repository.ReferenceBoardImpressionRepository;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 레퍼런스 보드 검색 노출 로깅 — 능동 수집 퍼널의 shown anchor 적재.
 *
 * <p>검색 응답 경로에서 호출되지만 <b>fail-safe</b>: 별도 트랜잭션({@code REQUIRES_NEW})으로 저장하고, 어떤 예외도 검색 결과 반환을 막지
 * 않는다 (에러만 로깅). {@link AnalyticsEventService} 와 동일한 원칙. 자기호출 프록시 문제를 피하려고 로깅 대상 서비스와 분리된 별도 빈이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ReferenceBoardImpressionService {

  private static final int MAX_QUERY_LEN = 255;

  private final ReferenceBoardImpressionRepository repository;

  /**
   * 검색으로 실제 노출된 image_id 들을 한 행씩 기록. imageIds 가 비면 no-op.
   *
   * @param userId 검색한 유저(없으면 null)
   * @param query 검색어 원문(255자 초과 시 절단)
   * @param source 소스 필터명(ALL/AI/PHOTO/…)
   * @param imageIds 노출된 이미지 id 목록(검색 결과 카드 기준)
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void record(Long userId, String query, String source, List<Long> imageIds) {
    if (imageIds == null || imageIds.isEmpty()) {
      return;
    }
    try {
      Instant now = Instant.now();
      String safeQuery =
          query == null || query.length() <= MAX_QUERY_LEN
              ? query
              : query.substring(0, MAX_QUERY_LEN);
      List<ReferenceBoardImpression> rows =
          imageIds.stream()
              .filter(java.util.Objects::nonNull)
              .map(
                  id -> {
                    ReferenceBoardImpression imp = new ReferenceBoardImpression();
                    imp.setImageId(id);
                    imp.setUserId(userId);
                    imp.setQuery(safeQuery);
                    imp.setSource(source);
                    imp.setShownAt(now);
                    return imp;
                  })
              .toList();
      repository.saveAll(rows);
    } catch (Exception e) {
      log.warn(
          "reference-board impression 로깅 실패: count={}, error_class={}",
          imageIds.size(),
          e.getClass().getSimpleName());
    }
  }
}
