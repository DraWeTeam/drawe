package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.AdminPage;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.BacklogRow;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.DemandRow;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.Friction;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.Kpi;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.View;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.WordRank;
import com.drawe.backend.domain.admin.repository.AdminSearchRepository;
import com.drawe.backend.domain.admin.repository.AdminSearchRepository.BacklogProj;
import com.drawe.backend.domain.admin.repository.AdminSearchRepository.BlockAbandonRow;
import com.drawe.backend.domain.admin.repository.AdminSearchRepository.DemandProj;
import com.drawe.backend.domain.admin.repository.AdminSearchRepository.FrictionCoreRow;
import com.drawe.backend.domain.admin.repository.AdminSearchRepository.KpiRow;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 검색 품질 탭 조립. 읽기 전용. */
@Service
@RequiredArgsConstructor
public class AdminSearchService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(KST);

  private static final int MIN_SIZE = 10;
  private static final int MAX_SIZE = 200;
  private static final int WORD_TOP_N = 30;

  private final AdminSearchRepository repo;

  /**
   * 검색 품질 뷰 조립.
   *
   * <p>backlog 섹션(시드 보강 백로그)과 demand 섹션(검색 수요 TOP)의 페이지·크기·검색어를 받아 조립한다.
   */
  @Transactional(readOnly = true)
  public View build(
      int windowHours,
      int backlogPage,
      int backlogSize,
      String backlogQ,
      int demandPage,
      int demandSize,
      String demandQ) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));

    KpiRow k = repo.kpi(since);
    long total = num(k.getTotal());
    long blocked = num(k.getBlocked());
    Double blockRate = total > 0 ? (double) blocked / total : null;
    Double successRate = blockRate == null ? null : 1.0 - blockRate; // KO 검색 성공률 (새 쿼리 0)
    Kpi kpi =
        new Kpi(
            windowHours,
            TS.format(Instant.now()),
            total,
            blocked,
            blockRate,
            successRate,
            k.getAvgResults(),
            k.getAvgScore());

    // 검색 마찰 (세션 기준, analytics_events) — 변경 없음
    FrictionCoreRow fc = repo.frictionCore(since);
    BlockAbandonRow ba = repo.blockAbandon(since);
    long searchSessions = num(fc.getSearchSessions());
    long researchSessions = num(fc.getResearchSessions());
    long loopSessions = num(fc.getLoopSessions());
    long blockedSessions = num(ba.getBlockedSessions());
    long abandonAfterBlock = num(ba.getAbandonAfterBlock());
    Double researchRate = searchSessions > 0 ? (double) researchSessions / searchSessions : null;
    Double abandonRate = blockedSessions > 0 ? (double) abandonAfterBlock / blockedSessions : null;
    Friction friction =
        new Friction(
            searchSessions,
            researchSessions,
            researchRate,
            loopSessions,
            blockedSessions,
            abandonAfterBlock,
            abandonRate);

    AdminPage<BacklogRow> backlog = pageBacklog(since, backlogPage, backlogSize, backlogQ);
    AdminPage<DemandRow> demandRaw = pageDemand(since, demandPage, demandSize, demandQ);

    // 교집합 강조: 현재 백로그 페이지의 keyword 집합 ∩ 수요 keyword → "고수요+약함".
    // 새 쿼리 없이 이미 조회한 두 리스트의 Java Set 교집합(페이지 범위 근사).
    Set<String> backlogKeywords =
        backlog.rows().stream().map(BacklogRow::keyword).collect(Collectors.toSet());
    List<DemandRow> demandRows =
        demandRaw.rows().stream()
            .map(
                r ->
                    new DemandRow(
                        r.keyword(),
                        r.count(),
                        r.avgResultCount(),
                        r.avgScore(),
                        r.blockedCount(),
                        backlogKeywords.contains(r.keyword())))
            .toList();
    AdminPage<DemandRow> demand =
        new AdminPage<>(
            demandRows, demandRaw.total(), demandRaw.page(), demandRaw.size(), demandRaw.q());

    // 검색어 어절 TOP — keyword+cnt 경량 집계를 자바에서 어절 분해(순수 유틸). original_message 미조회.
    List<WordRank> wordTopAll =
        SearchKeywordTokenizer.rank(toKeywordCounts(repo.wordSourceAll(since)), WORD_TOP_N);
    List<WordRank> wordTopLowQuality =
        SearchKeywordTokenizer.rank(toKeywordCounts(repo.wordSourceLowQuality(since)), WORD_TOP_N);

    return new View(kpi, friction, backlog, demand, wordTopAll, wordTopLowQuality);
  }

  private static List<SearchKeywordTokenizer.KeywordCount> toKeywordCounts(
      List<AdminSearchRepository.KeywordCountProj> rows) {
    return rows.stream()
        .map(p -> new SearchKeywordTokenizer.KeywordCount(p.getKeyword(), num(p.getCnt())))
        .toList();
  }

  private AdminPage<BacklogRow> pageBacklog(Instant since, int page, int size, String q) {
    int safePage = Math.max(1, page);
    int safeSize = Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
    String safeQ = q == null ? "" : q.trim();
    int offset = (safePage - 1) * safeSize;
    long total = repo.backlogCount(since, safeQ);
    List<BacklogRow> rows =
        repo.backlog(since, safeQ, safeSize, offset).stream().map(this::toBacklogRow).toList();
    return new AdminPage<>(rows, total, safePage, safeSize, safeQ);
  }

  private AdminPage<DemandRow> pageDemand(Instant since, int page, int size, String q) {
    int safePage = Math.max(1, page);
    int safeSize = Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
    String safeQ = q == null ? "" : q.trim();
    int offset = (safePage - 1) * safeSize;
    long total = repo.demandCount(since, safeQ);
    List<DemandRow> rows =
        repo.demand(since, safeQ, safeSize, offset).stream().map(this::toDemandRow).toList();
    return new AdminPage<>(rows, total, safePage, safeSize, safeQ);
  }

  private BacklogRow toBacklogRow(BacklogProj p) {
    return new BacklogRow(p.getKeyword(), num(p.getCnt()), p.getAvgScore(), p.getLastAt());
  }

  private DemandRow toDemandRow(DemandProj p) {
    // inBacklog는 build()에서 백로그 교집합으로 재계산(여기선 기본 false).
    return new DemandRow(
        p.getKeyword(),
        num(p.getCnt()),
        p.getAvgResults(),
        p.getAvgScore(),
        num(p.getBlockedCnt()),
        false);
  }

  /** COUNT/SUM 결과(Number, null 가능)를 long으로. */
  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }
}
