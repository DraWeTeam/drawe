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

    long sessions = num(r.getSessions());
    long started = num(r.getStarted());
    long searched = num(r.getSearched());
    long succeeded = num(r.getSucceeded());

    // 도달률 기준선은 '채팅 시작'이 아니라 '전체 세션'이다.
    // chat_start는 세션 신규 생성 시 1회만 적재되는데 chat_success는 매 메시지마다 적재되어,
    // 윈도우 경계를 걸친 세션 때문에 succeeded > started (=100% 초과)가 발생하기 때문.
    // 전체 세션을 분모로 쓰면 모든 단계가 항상 100% 이하가 된다.
    List<Stage> stages =
        List.of(
            stage("채팅 시작", started, sessions),
            stage("검색 실행", searched, sessions),
            stage("응답 성공", succeeded, sessions));

    // KO 헤드라인용 편의 필드 — 새 쿼리 없이 위에서 쓴 succeeded/sessions 재사용. 0~100, 분모 0이면 null.
    Double succeededReach = sessions > 0 ? succeeded * 100.0 / sessions : null;

    return new View(
        windowHours,
        TS.format(Instant.now()),
        sessions,
        stages,
        num(r.getBlocked()),
        num(r.getErrored()),
        num(r.getOnboarded()),
        succeededReach);
  }

  private static Stage stage(String label, long sessions, long base) {
    Double reach = base > 0 ? (double) sessions / base : null;
    int barPct = base > 0 ? (int) Math.round(Math.min(1.0, (double) sessions / base) * 100) : 0;
    return new Stage(label, sessions, reach, barPct);
  }

  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }
}
