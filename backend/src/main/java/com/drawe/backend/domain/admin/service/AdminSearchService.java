package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.SearchQualityModel.BacklogRow;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.DemandRow;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.Friction;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.Kpi;
import com.drawe.backend.domain.admin.dto.SearchQualityModel.View;
import com.drawe.backend.domain.admin.repository.AdminSearchRepository;
import com.drawe.backend.domain.admin.repository.AdminSearchRepository.BlockAbandonRow;
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

  private final AdminSearchRepository repo;

  @Transactional(readOnly = true)
  public View build(int windowHours) {
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

    // 검색 마찰 (세션 기준, analytics_events)
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

    List<BacklogRow> backlog =
        repo.backlog(since).stream()
            .map(
                p ->
                    new BacklogRow(p.getKeyword(), num(p.getCnt()), p.getAvgScore(), p.getLastAt()))
            .toList();

    List<DemandRow> demand =
        repo.demand(since).stream()
            .map(
                p ->
                    new DemandRow(
                        p.getKeyword(),
                        num(p.getCnt()),
                        p.getAvgResults(),
                        p.getAvgScore(),
                        num(p.getBlockedCnt())))
            .toList();

    return new View(kpi, friction, backlog, demand);
  }

  /** COUNT/SUM 결과(Number, null 가능)를 long으로. */
  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }
}
