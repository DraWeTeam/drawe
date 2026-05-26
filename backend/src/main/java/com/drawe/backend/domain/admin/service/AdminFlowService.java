package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.FlowModel.Stage;
import com.drawe.backend.domain.admin.dto.FlowModel.View;
import com.drawe.backend.domain.admin.repository.AdminFlowRepository;
import com.drawe.backend.domain.admin.repository.AdminFlowRepository.FlowRow;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이용 흐름 탭 조립. 읽기 전용. */
@Service
@RequiredArgsConstructor
public class AdminFlowService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(KST);

  private final AdminFlowRepository repo;

  @Transactional(readOnly = true)
  public View build(int windowHours) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));
    FlowRow r = repo.flow(since);

    long started = num(r.getStarted());
    long searched = num(r.getSearched());
    long succeeded = num(r.getSucceeded());

    List<Stage> stages =
        List.of(
            stage("채팅 시작", started, started),
            stage("검색 실행", searched, started),
            stage("응답 성공", succeeded, started));

    return new View(
        windowHours,
        TS.format(Instant.now()),
        num(r.getSessions()),
        stages,
        num(r.getBlocked()),
        num(r.getErrored()),
        num(r.getOnboarded()));
  }

  private static Stage stage(String label, long sessions, long start) {
    Double conv = start > 0 ? (double) sessions / start : null;
    int barPct = start > 0 ? (int) Math.round(Math.min(1.0, (double) sessions / start) * 100) : 0;
    return new Stage(label, sessions, conv, barPct);
  }

  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }
}
