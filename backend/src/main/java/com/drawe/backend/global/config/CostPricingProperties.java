package com.drawe.backend.global.config;

import com.drawe.backend.domain.enums.LlmProvider;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 어드민 Cost 탭의 비용 추정 단가. (USD, 1M 토큰당)
 *
 * <p><b>왜 코드에 단가를 박지 않나</b>: 모델 단가는 수시로 바뀌고, 잘못된 값을 자신 있게 박으면 오히려 해롭다. 그래서 단가는 전적으로 설정값(properties)
 * 으로만 주입받는다. 특정 provider 단가가 비어 있으면 그 provider의 비용은 {@code null} → 화면에 "—"로 표기하고 토큰 수만 보여준다. (호출 수·토큰은
 * 단가와 무관하게 항상 집계됨.)
 *
 * <p>설정 예 (application.properties):
 *
 * <pre>
 *   admin.cost.pricing.claude.input-per-1m=3.00
 *   admin.cost.pricing.claude.output-per-1m=15.00
 *   admin.cost.pricing.grok.input-per-1m=0.20
 *   admin.cost.pricing.grok.output-per-1m=0.50
 *   admin.cost.pricing.gemini.input-per-1m=0.10
 *   admin.cost.pricing.gemini.output-per-1m=0.40
 * </pre>
 *
 * <p>key는 {@link LlmProvider} 이름(대소문자 무시). 위 단가는 예시일 뿐 실제 청구 단가는 각 provider 콘솔에서 확인해 넣어야 한다.
 */
@Getter
@Setter
@Configuration
@ConfigurationProperties(prefix = "admin.cost")
public class CostPricingProperties {

  /**
   * 비용 누적 시 BigDecimal 의 division scale (소수점 자리 수). USD per token 은 매우 작은 값이라 (예: $3/1M = $0.000003) 6 자리면
   * 충분. 무한 소수가 나와도 ArithmeticException 안 던지도록 HALF_UP 으로 반올림.
   */
  private static final int COST_SCALE = 6;

  /** key = provider 이름(소문자 권장), value = 단가. */
  private Map<String, ModelPrice> pricing = new HashMap<>();

  /** provider 이름으로 단가 조회. 없으면 null. */
  public ModelPrice forProvider(String providerName) {
    if (providerName == null) {
      return null;
    }
    return pricing.get(providerName.toLowerCase(Locale.ROOT));
  }

  /**
   * 토큰 → USD 추정. 단가/토큰 어느 쪽이든 없으면 null.
   *
   * @param providerName payload의 provider 값 (예: "CLAUDE")
   */
  public BigDecimal estimateUsd(String providerName, Long promptTokens, Long completionTokens) {
    ModelPrice p = forProvider(providerName);
    if (p == null || p.getInputPer1m() == null || p.getOutputPer1m() == null) {
      return null;
    }
    long in = promptTokens != null ? promptTokens : 0L;
    long out = completionTokens != null ? completionTokens : 0L;
    BigDecimal million = new BigDecimal("1000000");
    // divide 에 scale + rounding mode 명시 — 안 하면 무한 소수에서 ArithmeticException.
    BigDecimal inCost =
        p.getInputPer1m()
            .multiply(BigDecimal.valueOf(in))
            .divide(million, COST_SCALE, RoundingMode.HALF_UP);
    BigDecimal outCost =
        p.getOutputPer1m()
            .multiply(BigDecimal.valueOf(out))
            .divide(million, COST_SCALE, RoundingMode.HALF_UP);
    return inCost.add(outCost);
  }

  /** 설정된 단가가 하나라도 있는지 — 없으면 화면에 "단가 미설정" 안내. */
  public boolean hasAnyPricing() {
    return pricing.values().stream()
        .anyMatch(p -> p != null && p.getInputPer1m() != null && p.getOutputPer1m() != null);
  }

  @Getter
  @Setter
  public static class ModelPrice {
    /** 입력(프롬프트) 1M 토큰당 USD. */
    private BigDecimal inputPer1m;

    /** 출력(완성) 1M 토큰당 USD. */
    private BigDecimal outputPer1m;
  }
}
