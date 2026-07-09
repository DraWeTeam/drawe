package com.drawe.backend.global.config;

import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import software.amazon.awssdk.services.costexplorer.CostExplorerClient;
import software.amazon.awssdk.services.costexplorer.model.GetCostAndUsageRequest;
import software.amazon.awssdk.services.costexplorer.model.GetCostAndUsageResponse;
import software.amazon.awssdk.services.costexplorer.model.Group;
import software.amazon.awssdk.services.costexplorer.model.MetricValue;
import software.amazon.awssdk.services.costexplorer.model.ResultByTime;

/**
 * 로컬 검증용 가짜 Cost Explorer 클라이언트 — {@code costmock} 프로파일에서만.
 *
 * <p>로컬엔 실제 AWS 비용/권한이 없으므로 canned 응답을 돌려준다. {@code AwsCostService} 의 실제 파싱·정렬·"기타" 합산·Bedrock
 * 소계 경로를 그대로 태워 화면 렌더를 확인한다. prod({@code s3})엔 {@link CostExplorerConfig} 의 실 클라이언트가 뜬다(서로 배타적
 * 프로파일).
 */
@Configuration
@Profile("costmock")
public class MockCostExplorerConfig {

  @Bean
  public CostExplorerClient costExplorerClient() {
    return new CannedCostExplorerClient();
  }

  /** 필요한 오퍼레이션만 override — 나머지는 SDK 기본(UnsupportedOperation)에 맡긴다. */
  static final class CannedCostExplorerClient implements CostExplorerClient {

    @Override
    public GetCostAndUsageResponse getCostAndUsage(GetCostAndUsageRequest request) {
      return GetCostAndUsageResponse.builder()
          .resultsByTime(
              ResultByTime.builder()
                  .groups(
                      List.of(
                          grp("Amazon Elastic Compute Cloud - Compute", "12.50"),
                          grp("Amazon Relational Database Service", "8.20"),
                          grp("Amazon Elastic Kubernetes Service", "5.00"),
                          grp("Amazon Simple Storage Service", "1.10"),
                          grp("Claude Haiku 4.5 (Amazon Bedrock Edition)", "0.80"),
                          grp("Stable Image Core (Amazon Bedrock Edition)", "0.40"),
                          grp("AmazonCloudWatch", "0.30"),
                          grp("Amazon Virtual Private Cloud", "0.20"),
                          grp("AWS Key Management Service", "0.05"),
                          grp("Amazon Route 53", "0.05")))
                  .build())
          .build();
    }

    private static Group grp(String service, String amount) {
      return Group.builder()
          .keys(service)
          .metrics(
              Map.of("UnblendedCost", MetricValue.builder().amount(amount).unit("USD").build()))
          .build();
    }

    @Override
    public String serviceName() {
      return "cost-explorer-mock";
    }

    @Override
    public void close() {
      // no-op
    }
  }
}
