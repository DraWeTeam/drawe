package com.drawe.backend.domain.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.drawe.backend.domain.admin.dto.CostModel.AwsCostSnapshot;
import com.drawe.backend.domain.admin.dto.CostModel.ServiceCost;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import software.amazon.awssdk.services.costexplorer.CostExplorerClient;
import software.amazon.awssdk.services.costexplorer.model.GetCostAndUsageRequest;
import software.amazon.awssdk.services.costexplorer.model.GetCostAndUsageResponse;
import software.amazon.awssdk.services.costexplorer.model.Group;
import software.amazon.awssdk.services.costexplorer.model.MetricValue;
import software.amazon.awssdk.services.costexplorer.model.ResultByTime;

/** AwsCostService — 파싱·정렬·"기타"·Bedrock 소계·캐시·예외 안전 단위 테스트. CE 실호출 없음(전부 mock). */
class AwsCostServiceTest {

  @SuppressWarnings("unchecked")
  private static ObjectProvider<CostExplorerClient> providerOf(CostExplorerClient client) {
    ObjectProvider<CostExplorerClient> p = mock(ObjectProvider.class);
    when(p.getIfAvailable()).thenReturn(client);
    return p;
  }

  private static Group grp(String service, String amount) {
    return Group.builder()
        .keys(service)
        .metrics(Map.of("UnblendedCost", MetricValue.builder().amount(amount).unit("USD").build()))
        .build();
  }

  private static GetCostAndUsageResponse respWith(Group... groups) {
    return GetCostAndUsageResponse.builder()
        .resultsByTime(ResultByTime.builder().groups(List.of(groups)).build())
        .build();
  }

  @Test
  void 총액_정렬_bedrock소계() {
    CostExplorerClient client = mock(CostExplorerClient.class);
    when(client.getCostAndUsage(any(GetCostAndUsageRequest.class)))
        .thenReturn(
            respWith(
                grp("Amazon RDS", "8.00"),
                grp("Amazon EC2", "12.00"),
                grp("Claude Haiku 4.5 (Amazon Bedrock Edition)", "0.80"),
                grp("Stable Image Core (Amazon Bedrock Edition)", "0.40")));

    AwsCostSnapshot s = new AwsCostService(providerOf(client)).getMonthlySnapshot();

    assertThat(s.available()).isTrue();
    assertThat(s.totalUsd()).isEqualByComparingTo("21.20"); // 8+12+0.8+0.4
    assertThat(s.aiSubtotalUsd()).isEqualByComparingTo("1.20"); // bedrock edition 두 개
    // 금액 내림차순 정렬
    assertThat(s.services().stream().map(ServiceCost::service))
        .containsExactly(
            "Amazon EC2",
            "Amazon RDS",
            "Claude Haiku 4.5 (Amazon Bedrock Edition)",
            "Stable Image Core (Amazon Bedrock Edition)");
  }

  @Test
  void 상위N_초과분은_기타로_합산() {
    // TOP_N=8 → 10개 넣으면 상위 8 + "기타"(하위 2 합)
    Group[] gs = new Group[10];
    for (int i = 0; i < 10; i++) {
      gs[i] = grp("svc-" + i, String.valueOf(10 - i)); // 10,9,...,1
    }
    CostExplorerClient client = mock(CostExplorerClient.class);
    when(client.getCostAndUsage(any(GetCostAndUsageRequest.class))).thenReturn(respWith(gs));

    AwsCostSnapshot s = new AwsCostService(providerOf(client)).getMonthlySnapshot();

    assertThat(s.services()).hasSize(9); // 8 + 기타
    ServiceCost last = s.services().get(8);
    assertThat(last.service()).isEqualTo("기타");
    assertThat(last.amountUsd()).isEqualByComparingTo("3"); // 하위 2개 = 2+1
    assertThat(s.totalUsd()).isEqualByComparingTo("55"); // 10..1 합
  }

  @Test
  void 캐시_2회호출시_CE_1회만() {
    CostExplorerClient client = mock(CostExplorerClient.class);
    when(client.getCostAndUsage(any(GetCostAndUsageRequest.class)))
        .thenReturn(respWith(grp("Amazon EC2", "1.00")));

    AwsCostService svc = new AwsCostService(providerOf(client));
    svc.getMonthlySnapshot();
    svc.getMonthlySnapshot();

    verify(client, times(1)).getCostAndUsage(any(GetCostAndUsageRequest.class));
  }

  @Test
  void CE예외시_available_false_페이지안죽음() {
    CostExplorerClient client = mock(CostExplorerClient.class);
    when(client.getCostAndUsage(any(GetCostAndUsageRequest.class)))
        .thenThrow(new RuntimeException("AccessDenied"));

    AwsCostSnapshot s = new AwsCostService(providerOf(client)).getMonthlySnapshot();

    assertThat(s.available()).isFalse();
    assertThat(s.statusText()).contains("권한");
    assertThat(s.totalUsd()).isNull();
    assertThat(s.services()).isEmpty();
  }

  @Test
  void 클라이언트_부재시_미설정_안내() {
    AwsCostSnapshot s = new AwsCostService(providerOf(null)).getMonthlySnapshot();
    assertThat(s.available()).isFalse();
    assertThat(s.statusText()).contains("미설정");
  }
}
