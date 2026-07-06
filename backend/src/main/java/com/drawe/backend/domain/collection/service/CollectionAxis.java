package com.drawe.backend.domain.collection.service;

import java.util.Optional;

/**
 * 아카이브 컬렉션 자동분류 축 — guideLabels.js AXIS_LABELS / taxonomy.yaml 과 동일 id 체계.
 *
 * <p>CLIP zero-shot 신뢰도가 높은 "느낌" 축 6종만 담는다(ai_qc AI_ELIGIBLE_AXES 정책과 동일 — 손/비율/관절 등 형태 축은
 * CLIP 신뢰 낮아 제외). {@code label} 은 축 컬렉션 이름, {@code probe} 는 CLIP 텍스트 임베딩용 영어 쿼리(taxonomy
 * reference_query). 가이드 §4 저장은 축 id 를 직접 받아 {@link #fromId} 로, 검색/AI/업로드는 CLIP 코사인으로 이 축들을
 * 판별한다.
 */
public enum CollectionAxis {
  VALUE_STRUCTURE(
      "value_structure", "명암 대비", "value study strong light shadow high contrast"),
  COMPOSITION_BALANCE(
      "composition_balance",
      "구도·균형",
      "painting off-center subject open sky negative space"),
  COLOR_HARMONY("color_harmony", "색 조화", "limited color palette harmony painting"),
  LIGHT_DIRECTION(
      "light_direction", "광원 방향", "single light source form shadow direction study"),
  ATMOSPHERIC_PERSPECTIVE(
      "atmospheric_perspective",
      "대기 원근",
      "atmospheric perspective distant mountains haze depth landscape"),
  DEPTH_LAYERING(
      "depth_layering",
      "깊이 층",
      "foreground midground background depth layers landscape composition");

  private final String id;
  private final String label;
  private final String probe;

  CollectionAxis(String id, String label, String probe) {
    this.id = id;
    this.label = label;
    this.probe = probe;
  }

  public String id() {
    return id;
  }

  public String label() {
    return label;
  }

  public String probe() {
    return probe;
  }

  /** 축 id(예 value_structure)로 조회. 6종 밖(형태 축 등)이면 empty → 호출 측이 "미분류" 폴백. */
  public static Optional<CollectionAxis> fromId(String id) {
    if (id == null) {
      return Optional.empty();
    }
    for (CollectionAxis a : values()) {
      if (a.id.equals(id)) {
        return Optional.of(a);
      }
    }
    return Optional.empty();
  }
}
