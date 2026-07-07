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
 * SCRUM-118: 레퍼런스 생성 대화 1건(프롬프트 → 생성 이미지). 보드 진입 시 생성 채팅 복원용(가이드 채팅처럼 서버 저장).
 *
 * <p>url 은 원본(미서명) — 조회 시 {@code signed()} 로 감싸 만료 없는 신선한 URL 을 준다.
 */
@Entity
@Table(
    name = "reference_generations",
    indexes = {
      @Index(name = "idx_refgen_project_user", columnList = "project_id, user_id, created_at")
    })
@Getter
@Setter
@NoArgsConstructor
public class ReferenceGeneration {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "project_id", nullable = false)
  private Long projectId;

  @Column(name = "user_id", nullable = false)
  private Long userId;

  @Column(name = "prompt", length = 500, nullable = false)
  private String prompt;

  @Column(name = "image_id", nullable = false)
  private Long imageId;

  @Column(name = "url", length = 1000)
  private String url;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;
}
