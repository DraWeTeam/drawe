package com.drawe.backend.domain.reference;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 레퍼런스 보드 검색 노출 1건 — 유저가 검색으로 "실제로 본" 결과 카드 한 장.
 *
 * <p>능동 수집(active curation) 퍼널의 board 세그먼트 anchor(shown). 기본 그리드 노출은 기록하지 않고 의도적 검색 결과만 남긴다. 저장은 하지
 * 않는 fail-safe 로깅이라 검색 응답 지연/실패에 영향 주지 않는다.
 */
@Entity
@Table(
    name = "reference_board_impressions",
    indexes = {
      @Index(name = "idx_rbimp_image", columnList = "image_id"),
      @Index(name = "idx_rbimp_shown", columnList = "shown_at")
    })
@Getter
@Setter
@NoArgsConstructor
public class ReferenceBoardImpression {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "image_id", nullable = false)
  private Long imageId;

  @Column(name = "user_id")
  private Long userId;

  /** 검색어 원문(운영 참고용). 길이 제한 초과 시 잘라 저장. */
  @Column(name = "query", length = 255)
  private String query;

  /** 소스 필터(ALL/AI/PHOTO/…). {@code ReferenceSource#name()}. */
  @Column(name = "source", length = 20)
  private String source;

  @Column(name = "shown_at", nullable = false)
  private Instant shownAt;
}
