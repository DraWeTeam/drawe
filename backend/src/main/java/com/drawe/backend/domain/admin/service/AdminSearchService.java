package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.AdminPage;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.BacklogRow;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.DemandRow;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.Friction;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.Kpi;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.View;
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
    Kpi kpi =
        new Kpi(
            windowHours,
            TS.format(Instant.now()),
            total,
            blocked,
            blockRate,
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
    AdminPage<DemandRow> demand = pageDemand(since, demandPage, demandSize, demandQ);

    return new View(kpi, friction, backlog, demand);
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
    return new DemandRow(
        p.getKeyword(),
        num(p.getCnt()),
        p.getAvgResults(),
        p.getAvgScore(),
        num(p.getBlockedCnt()));
  }

  /** COUNT/SUM 결과(Number, null 가능)를 long으로. */
  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }
}
