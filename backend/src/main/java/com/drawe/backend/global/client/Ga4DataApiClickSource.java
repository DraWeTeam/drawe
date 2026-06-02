package com.drawe.backend.global.client;

import com.google.analytics.data.v1beta.BetaAnalyticsDataClient;
import com.google.analytics.data.v1beta.BetaAnalyticsDataSettings;
import com.google.analytics.data.v1beta.DateRange;
import com.google.analytics.data.v1beta.Dimension;
import com.google.analytics.data.v1beta.Filter;
import com.google.analytics.data.v1beta.FilterExpression;
import com.google.analytics.data.v1beta.Metric;
import com.google.analytics.data.v1beta.Row;
import com.google.analytics.data.v1beta.RunReportRequest;
import com.google.analytics.data.v1beta.RunReportResponse;
import com.google.api.gax.core.FixedCredentialsProvider;
import com.google.auth.oauth2.GoogleCredentials;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * GA4 Data API 로 {@code prompt_reference_viewed} 클릭 수를 reference_id 별로 가져온다.
 *
 * <p><b>자격증명 두 경로</b> (둘 다 지원, env 우선):
 *
 * <ul>
 *   <li><b>배포(ECS)</b>: SSM SecureString -> env {@code GA4_SA_KEY_JSON}(=property {@code
 *       admin.ga4.sa-key-json}) 로 JSON <i>내용</i>이 주입됨 -> 그 문자열로 인증. 파일 불필요.
 *   <li><b>로컬</b>: env 비우고 {@code GOOGLE_APPLICATION_CREDENTIALS=/path/key.json}(파일) 로 ADC 사용.
 * </ul>
 *
 * <p>커스텀 측정기준은 Data API 에서 {@code customEvent:reference_id}. 이벤트 필터 {@code eventName ==
 * prompt_reference_viewed}.
 *
 * <p>회복력: property-id 미설정/호출 실패 시 빈 맵 + {@link #isAvailable()}=false. GA4 가 죽어도 DB 집계는 정상.
 */
@Slf4j
@Component
public class Ga4DataApiClickSource implements Ga4ClickSource {

  private static final DateTimeFormatter DATE =
      DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneId.of("Asia/Seoul"));
  private static final String ANALYTICS_READONLY =
      "https://www.googleapis.com/auth/analytics.readonly";

  private final String propertyId;
  private final String saKeyJson; // ECS env(SSM) 로 받은 JSON 내용. 비면 파일(ADC) 사용.

  public Ga4DataApiClickSource(
      @Value("${admin.ga4.property-id:}") String propertyId,
      @Value("${admin.ga4.sa-key-json:}") String saKeyJson) {
    this.propertyId = propertyId;
    this.saKeyJson = saKeyJson;
  }

  @Override
  public boolean isAvailable() {
    return propertyId != null && !propertyId.isBlank();
  }

  @Override
  public Map<Long, Long> clicksByImageId(Instant since) {
    if (!isAvailable()) {
      log.info("GA4 property-id 미설정 -> 클릭 데이터 없이 진행 (DB 집계만)");
      return Map.of();
    }

    Map<Long, Long> result = new HashMap<>();
    try (BetaAnalyticsDataClient client = buildClient()) {
      RunReportRequest request =
          RunReportRequest.newBuilder()
              .setProperty("properties/" + propertyId)
              .addDimensions(Dimension.newBuilder().setName("customEvent:reference_id"))
              .addMetrics(Metric.newBuilder().setName("eventCount"))
              .addDateRanges(
                  DateRange.newBuilder().setStartDate(DATE.format(since)).setEndDate("today"))
              .setDimensionFilter(
                  FilterExpression.newBuilder()
                      .setFilter(
                          Filter.newBuilder()
                              .setFieldName("eventName")
                              .setStringFilter(
                                  Filter.StringFilter.newBuilder()
                                      .setValue("prompt_reference_viewed")))
                      .build())
              .setLimit(100000)
              .build();

      RunReportResponse resp = client.runReport(request);
      for (Row row : resp.getRowsList()) {
        Long imageId = parseLong(row.getDimensionValues(0).getValue()); // reference_id
        if (imageId == null) {
          continue; // "(not set)" 등 스킵
        }
        result.merge(imageId, parseLongOrZero(row.getMetricValues(0).getValue()), Long::sum);
      }
      log.info("GA4 클릭 로드 완료: {}개 reference_id", result.size());
    } catch (Exception e) {
      // 진짜 원인 파악용 — error_class 만으론 IOException 같은 래퍼만 보이고 안에 뭐가 있는지 모름.
      Throwable root = e;
      while (root.getCause() != null && root.getCause() != root) {
        root = root.getCause();
      }
      log.warn(
          "GA4 Data API 클릭 조회 실패, 클릭 없이 진행: error_class={}, message={}, root_class={}, root_message={}",
          e.getClass().getSimpleName(),
          e.getMessage(),
          root.getClass().getSimpleName(),
          root.getMessage());
      return Map.of();
    }
    return result;
  }

  /** env 에 JSON 내용이 있으면 그걸로, 없으면 파일 기반 ADC(GOOGLE_APPLICATION_CREDENTIALS). */
  private BetaAnalyticsDataClient buildClient() throws IOException {
    if (saKeyJson != null && !saKeyJson.isBlank()) {
      GoogleCredentials creds =
          GoogleCredentials.fromStream(
                  new ByteArrayInputStream(saKeyJson.getBytes(StandardCharsets.UTF_8)))
              .createScoped(List.of(ANALYTICS_READONLY));
      BetaAnalyticsDataSettings settings =
          BetaAnalyticsDataSettings.newBuilder()
              .setCredentialsProvider(FixedCredentialsProvider.create(creds))
              .build();
      return BetaAnalyticsDataClient.create(settings);
    }
    return BetaAnalyticsDataClient.create(); // 로컬: 파일 ADC
  }

  private static Long parseLong(String s) {
    try {
      return Long.parseLong(s.trim());
    } catch (Exception e) {
      return null;
    }
  }

  private static long parseLongOrZero(String s) {
    Long v = parseLong(s);
    return v == null ? 0L : v;
  }
}
