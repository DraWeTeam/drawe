package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.ChipModel.ChipRow;
import com.drawe.backend.domain.admin.dto.ChipModel.View;
import com.drawe.backend.domain.admin.repository.AdminChipRepository;
import com.drawe.backend.domain.admin.service.ChipAnalyzer.ReflectAgg;
import com.drawe.backend.domain.admin.service.ChipAnalyzer.ShownAgg;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 칩 분석 탭 조립 — AI 추천 칩의 노출→반영 전환율. DB 집계만 하고 정규화·조인·정렬·전환율은 {@link ChipAnalyzer}(순수 함수)에 위임. */
@Service
@RequiredArgsConstructor
public class ChipService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(KST);

  /** 노출 표본이 이 미만이면 전환율 해석 주의(계측 최근 시작). */
  private static final long LOW_DATA_SHOWN = 30;

  private final AdminChipRepository repo;

  @Transactional(readOnly = true)
  public View build(int windowHours) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));

    List<ShownAgg> shown =
        repo.shownByLabel(since).stream()
            .map(
                p ->
                    new ShownAgg(
                        p.getLabel(),
                        num(p.getCnt()),
                        p.getAvgPosition() == null ? 0d : p.getAvgPosition()))
            .toList();
    List<ReflectAgg> reflect =
        repo.reflectByLabel(since).stream()
            .map(p -> new ReflectAgg(p.getLabel(), num(p.getCnt())))
            .toList();

    List<ChipRow> rows = ChipAnalyzer.join(shown, reflect);

    long totalShown = rows.stream().mapToLong(ChipRow::shown).sum();
    // KO 분자 = 노출된 라벨의 반영수만(노출 미기록 라벨은 전환율 계산에서 제외 — 계측 전 프로젝트라 왜곡).
    long reflectAmongShown =
        rows.stream().filter(r -> r.shown() > 0).mapToLong(ChipRow::reflect).sum();
    long totalReflect = rows.stream().mapToLong(ChipRow::reflect).sum();

    Double ko = totalShown > 0 ? (double) reflectAmongShown / totalShown : null;
    boolean lowData = totalShown < LOW_DATA_SHOWN;
    String koReliability = (ko != null && !lowData) ? "green" : "yellow";

    return new View(
        TS.format(Instant.now()), ko, koReliability, totalShown, totalReflect, lowData, rows);
  }

  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }
}
