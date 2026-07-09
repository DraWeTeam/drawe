package com.drawe.backend.global.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.costexplorer.CostExplorerClient;

/**
 * AWS Cost Explorer 클라이언트 빈 — {@code s3} 프로파일(=prod/dev 배포)에서만 생성된다.
 *
 * <p>로컬/테스트 기본 프로파일에선 이 빈이 없으므로 {@code AwsCostService} 가 "비용 데이터 없음"으로 안전하게 렌더한다(로컬 mock 은 {@code
 * costmock} 프로파일이 별도 스텁 빈을 준다).
 *
 * <p><b>Region 주의</b>: Cost Explorer 엔드포인트는 글로벌이지만 SDK 는 리전으로 {@code us-east-1} 을 요구한다 —
 * S3(ap-northeast-2) 와 다르다. 자격증명은 {@link S3Config} 와 동일하게 {@link
 * DefaultCredentialsProvider}(IRSA→env→~/.aws) 표준 체인, HTTP 클라이언트도 동일하게 {@link
 * UrlConnectionHttpClient}(apache5-client exclude 영향 회피).
 *
 * <p>권한은 WP4-b(IAM)에서 {@code ce:GetCostAndUsage}(Resource *) 를 붙인다. 그 전엔 prod 에서도 AccessDenied 가 날
 * 수 있으나 {@code AwsCostService} 가 예외를 삼켜 페이지는 정상 렌더된다.
 */
@Configuration
@Profile("s3")
public class CostExplorerConfig {

  @Bean
  public CostExplorerClient costExplorerClient() {
    return CostExplorerClient.builder()
        .region(Region.US_EAST_1) // CE 는 us-east-1 고정
        .credentialsProvider(DefaultCredentialsProvider.create())
        .httpClient(UrlConnectionHttpClient.create())
        .build();
  }
}
