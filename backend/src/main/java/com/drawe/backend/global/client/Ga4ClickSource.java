package com.drawe.backend.global.client;

import java.time.Instant;
import java.util.Map;

/**
 * GA4 {@code prompt_reference_viewed} 클릭 수를 reference_id(=image_id)별로 가져오는 포트.
 *
 * <p>인터페이스로 분리한 이유: DB 쪽 집계(노출/좋아요/핀)는 이 소스 없이도 돌아가야 하기 때문. GA4 자격증명이 아직 없으면 빈 맵을 돌려주는 구현({@code
 * EmptyGa4ClickSource})을, 준비되면 {@link Ga4DataApiClickSource}를 쓰면 된다.
 */
public interface Ga4ClickSource {

  /**
   * 기간 내 이미지(reference_id)별 클릭 수를 집계한다.
   *
   * @param since 집계 시작 시각 (KST 날짜로 변환해 GA4 startDate 로 사용)
   * @return reference_id(image_id) → 클릭 수. 데이터 없거나 미설정이면 빈 맵.
   */
  Map<Long, Long> clicksByImageId(Instant since);

  /** GA4 연동이 실제로 활성화돼 있는지 (화면에 "클릭 데이터 없음" 안내용). */
  boolean isAvailable();
}
