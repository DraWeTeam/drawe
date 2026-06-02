package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.CostModel.DailyGen;
import com.drawe.backend.domain.admin.dto.CostModel.Kpi;
import com.drawe.backend.domain.admin.dto.CostModel.ProviderRow;
import com.drawe.backend.domain.admin.dto.CostModel.View;
import com.drawe.backend.domain.admin.repository.AdminCostRepository;
import com.drawe.backend.domain.admin.repository.AdminCostRepository.AiImageRow;
import com.drawe.backend.domain.admin.repository.AdminCostRepository.ProviderProj;
import com.drawe.backend.domain.admin.repository.AdminCostRepository.TokenKpiRow;
import com.drawe.backend.global.config.CostPricingProperties;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 비용·사용량 탭 조립. 읽기 전용. */
@Service
@RequiredArgsConstructor
public class AdminCostService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(KST);

  private final AdminCostRepository repo;
  private final CostPricingProperties pricing;

  @Transactional(readOnly = true)
  public View build(int windowHours) {
    Instant since = Instant.now().minus(Duration.ofHours(windowHours));

    TokenKpiRow t = repo.tokenKpi(since);
    long promptTokens = num(t.getPromptTokens());
    long completionTokens = num(t.getCompletionTokens());

    List<ProviderRow> providers =
        repo.providerBreakdown(since).stream().map(this::toProviderRow).toList();

    // 전체 추정 비용 = provider별 추정치 합(단가 있는 것만). 하나라도 있으면 합산, 전부 없으면 null.
    BigDecimal totalCost = null;
    for (ProviderRow p : providers) {
      if (p.estCostUsd() != null) {
        totalCost = (totalCost == null ? BigDecimal.ZERO : totalCost).add(p.estCostUsd());
      }
    }

    AiImageRow ai = repo.aiImageTotals();

    Kpi kpi =
        new Kpi(
            num(t.getChatCalls()),
            num(t.getCallsWithTokens()),
            promptTokens,
            completionTokens,
            totalCost,
            repo.imageGenCount(since),
            num(ai.getTotal()),
            num(ai.getIndexed()));

    List<DailyGen> daily =
        repo.dailyImageGen(since).stream()
            .map(d -> new DailyGen(d.getDay(), num(d.getCnt())))
            .toList();

    return new View(
        windowHours, TS.format(Instant.now()), kpi, providers, daily, pricing.hasAnyPricing());
  }

  private ProviderRow toProviderRow(ProviderProj p) {
    long in = num(p.getPromptTokens());
    long out = num(p.getCompletionTokens());
    BigDecimal cost = pricing.estimateUsd(p.getProvider(), in, out);
    return new ProviderRow(p.getProvider(), p.getModel(), num(p.getCalls()), in, out, cost);
  }

  private static long num(Number n) {
    return n == null ? 0L : n.longValue();
  }
}
