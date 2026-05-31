package com.drawe.backend.domain.admin.dto;

import java.util.List;

/**
 * 어드민 "태그별 레퍼런스 관심도" 탭 뷰모델.
 *
 * <p>한 이미지는 technique·subject·mood 세 축의 태그를 동시에 가지므로, 축별로 따로 롤업한다(한 이미지의 engagement는 자기
 * technique 값, subject 값, mood 값 버킷에 각각 더해진다).
 *
 * <p>신호 출처:
 *
 * <ul>
 *   <li>shown(노출)  — llm_messages.references_json (백엔드 DB)
 *   <li>likes(좋아요) — image_feedback feedback='LIKE' (백엔드 DB)
 *   <li>pins(핀)     — projects.pinned_image_ids 스냅샷 (백엔드 DB, 시각 없음)
 *   <li>clicks(클릭) — GA4 prompt_reference_viewed (Data API, {@link
 *       com.drawe.backend.global.client.Ga4ClickSource})
 * </ul>
 */
public record TagEngagementModel() {

  public record View(String generatedAtText, boolean clicksAvailable, List<AxisRollup> axes) {}

  /** 한 축(technique/subject/mood)의 태그별 집계. */
  public record AxisRollup(String axis, List<TagRow> rows) {}

  /** 태그 값 하나의 집계치. */
  public record TagRow(
      String value,
      long images, // 이 태그를 가진, engagement 있는 이미지 수
      long shown,
      long clicks,
      long likes,
      long pins,
      Double ctr) {} // clicks/shown, shown=0이면 null
}
