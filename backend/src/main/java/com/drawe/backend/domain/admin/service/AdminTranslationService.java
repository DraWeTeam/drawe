package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.TranslationModel.FailureRow;
import com.drawe.backend.domain.admin.dto.TranslationModel.Kpi;
import com.drawe.backend.domain.admin.dto.TranslationModel.View;
import com.drawe.backend.domain.admin.repository.AdminTranslationRepository;
import com.drawe.backend.domain.admin.repository.AdminTranslationRepository.KpiRow;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 번역 실패 탭 조립. 읽기 전용. */
@Service
@RequiredArgsConstructor
public class AdminTranslationService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(KST);

  private final AdminTranslationRepository repo;

  @Transactional(readOnly = true)
  public View build(int windowHours) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));

    KpiRow k = repo.kpi(since);
    long total = num(k.getTotal());
    long success = num(k.getSuccess());
    long fallback = num(k.getFallback());
    long failed = num(k.getFailed());

    Kpi kpi =
        new Kpi(
            windowHours,
            TS.format(Instant.now()),
            total,
            success,
            fallback,
            failed,
            rate(success, total),
            rate(fallback, total),
            rate(failed, total));

    List<FailureRow> failures =
        repo.failures(since).stream()
            .map(p -> new FailureRow(p.getReason(), p.getStatus(), num(p.getCnt()), p.getLastAt()))
            .toList();

    return new View(kpi, failures);
  }

  private static Double rate(long n, long d) {
    return d > 0 ? (double) n / d : null;
  }

  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }
}
