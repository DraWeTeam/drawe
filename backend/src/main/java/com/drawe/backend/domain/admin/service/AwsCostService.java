package com.drawe.backend.domain.admin.service;

import com.drawe.backend.domain.admin.dto.CostModel.AwsCostSnapshot;
import com.drawe.backend.domain.admin.dto.CostModel.ServiceCost;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.costexplorer.CostExplorerClient;
import software.amazon.awssdk.services.costexplorer.model.DateInterval;
import software.amazon.awssdk.services.costexplorer.model.GetCostAndUsageRequest;
import software.amazon.awssdk.services.costexplorer.model.GetCostAndUsageResponse;
import software.amazon.awssdk.services.costexplorer.model.Granularity;
import software.amazon.awssdk.services.costexplorer.model.Group;
import software.amazon.awssdk.services.costexplorer.model.GroupDefinition;
import software.amazon.awssdk.services.costexplorer.model.GroupDefinitionType;
import software.amazon.awssdk.services.costexplorer.model.MetricValue;
import software.amazon.awssdk.services.costexplorer.model.ResultByTime;

/**
 * AWS Cost Explorer 기반 당월 지출 조회. 전체 AWS 비용 + 서비스(SERVICE 디멘션)별 분해 + LLM·이미지(Bedrock Edition) 소계.
 *
 * <p><b>왜 CE 인가</b>: 기존 비용 탭은 chat_success 토큰만 봐서 실비용의 극히 일부만 반영했다. 실제 지출은 인프라(EC2/RDS/EKS)와
 * Bedrock 모델이 대부분이고, 그건 AWS 청구에만 있다. 태그(cost allocation)가 없어 기능별 분해는 불가 → SERVICE 디멘션으로만 나눈다.
 *
 * <p><b>안전 원칙</b>: CE 는 호출당 $0.01 + 하루 지연이라 매 요청 호출하면 안 된다 → 1시간 in-memory 캐시. 권한 미설정
 * (AccessDenied) · 클라이언트 부재(로컬)에도 페이지가 죽지 않게 예외를 삼키고 {@code available=false} 스냅샷을 돌려준다.
 *
 * <p>Metric 은 {@code UnblendedCost}, Granularity {@code MONTHLY}(당월 1일~오늘, month-to-date).
 */
@Slf4j
@Service
public class AwsCostService {

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final long TTL_MS = 3_600_000L; // 1시간
  private static final int TOP_N = 8; // 상위 N 서비스, 나머지는 "기타"
  private static final String BEDROCK_MARKER = "(Amazon Bedrock Edition)";
  private static final String METRIC = "UnblendedCost";

  /** ObjectProvider 로 받아 클라이언트 빈이 없을 때(로컬 기본)도 안전. */
  private final ObjectProvider<CostExplorerClient> clientProvider;

  private volatile AwsCostSnapshot cached;
  private volatile long cachedAt;

  public AwsCostService(ObjectProvider<CostExplorerClient> clientProvider) {
    this.clientProvider = clientProvider;
  }

  /** 1시간 캐시된 당월 스냅샷. 캐시 미스일 때만 CE 를 1회 호출한다. */
  public synchronized AwsCostSnapshot getMonthlySnapshot() {
    long now = System.currentTimeMillis();
    if (cached != null && now - cachedAt < TTL_MS) {
      return cached;
    }
    AwsCostSnapshot snap = fetch();
    cached = snap;
    cachedAt = now;
    return snap;
  }

  private AwsCostSnapshot fetch() {
    CostExplorerClient client = clientProvider.getIfAvailable();
    LocalDate today = LocalDate.now(KST);
    LocalDate monthStart = today.withDayOfMonth(1);
    String monthLabel = monthStart.getYear() + "년 " + monthStart.getMonthValue() + "월 (1일~오늘)";

    if (client == null) {
      return unavailable("비용 데이터 없음 (미설정)", monthLabel);
    }
    try {
      // CE 의 종료일은 exclusive. 1일이면 start==end 가 되어 무효하므로 최소 하루 폭을 준다.
      LocalDate end = today.isEqual(monthStart) ? today.plusDays(1) : today;
      GetCostAndUsageRequest req =
          GetCostAndUsageRequest.builder()
              .timePeriod(
                  DateInterval.builder().start(monthStart.toString()).end(end.toString()).build())
              .granularity(Granularity.MONTHLY)
              .metrics(METRIC)
              .groupBy(
                  GroupDefinition.builder()
                      .type(GroupDefinitionType.DIMENSION)
                      .key("SERVICE")
                      .build())
              .build();

      GetCostAndUsageResponse resp = client.getCostAndUsage(req);

      BigDecimal total = BigDecimal.ZERO;
      BigDecimal aiSubtotal = BigDecimal.ZERO;
      List<ServiceCost> all = new ArrayList<>();
      for (ResultByTime rbt : resp.resultsByTime()) {
        for (Group g : rbt.groups()) {
          String service = g.keys().isEmpty() ? "(unknown)" : g.keys().get(0);
          MetricValue mv = g.metrics().get(METRIC);
          BigDecimal amount = mv == null ? BigDecimal.ZERO : new BigDecimal(mv.amount());
          all.add(new ServiceCost(service, amount));
          total = total.add(amount);
          if (service.contains(BEDROCK_MARKER)) {
            aiSubtotal = aiSubtotal.add(amount);
          }
        }
      }
      return new AwsCostSnapshot(true, null, monthLabel, total, topNWithOther(all), aiSubtotal);
    } catch (Exception e) {
      // 권한 미설정(AccessDenied) 포함 — 로그만 남기고 화면은 안내로.
      log.warn("Cost Explorer 조회 실패: error_class={}", e.getClass().getSimpleName());
      return unavailable("비용 데이터 없음 (권한 미설정)", monthLabel);
    }
  }

  /** 금액 내림차순 상위 N + 나머지 "기타" 1행. */
  private static List<ServiceCost> topNWithOther(List<ServiceCost> all) {
    all.sort(Comparator.comparing(ServiceCost::amountUsd).reversed());
    List<ServiceCost> out = new ArrayList<>();
    BigDecimal other = BigDecimal.ZERO;
    for (int i = 0; i < all.size(); i++) {
      if (i < TOP_N) {
        out.add(all.get(i));
      } else {
        other = other.add(all.get(i).amountUsd());
      }
    }
    if (other.compareTo(BigDecimal.ZERO) > 0) {
      out.add(new ServiceCost("기타", other));
    }
    return out;
  }

  private static AwsCostSnapshot unavailable(String status, String monthLabel) {
    return new AwsCostSnapshot(false, status, monthLabel, null, List.of(), null);
  }
}
