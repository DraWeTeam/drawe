package com.drawe.backend.domain;

import com.drawe.backend.global.client.dto.GuideResponse;
import jakarta.persistence.*;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;
import org.hibernate.type.SqlTypes;

/**
 * 이미지 가이딩 결과(한 끗 가이드) 영속 레코드. 사용자 대면 "지난 가이드"·PDF·레퍼런스 재방문의 근거.
 *
 * <p>payload = FastAPI /guide 응답(GuideResponse) 전체. reference_ids 형태로 보관하고(만료되는 presigned URL은 저장하지
 * 않음) 조회 시 재보강한다. request_id = Spring 발급 멱등 키(재시도 시 at-most-once 영속, UNIQUE 보장).
 */
@Getter
@Setter
@Entity
@Table(
    name = "guides",
    uniqueConstraints = {
      @UniqueConstraint(name = "uk_guides_request_id", columnNames = "request_id")
    },
    indexes = {
      @Index(
          name = "idx_guides_user_project_created",
          columnList = "user_id, project_id, created_at"),
      @Index(name = "idx_guides_guide_id", columnList = "guide_id")
    })
public class Guide {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "id", nullable = false)
  private Long id;

  /** Spring 발급 멱등 키(at-most-once 영속). */
  @Column(name = "request_id", nullable = false, length = 64)
  private String requestId;

  /** FastAPI 가 발급한 guide_id(coach 모드). 비-coach 면 null. */
  @Column(name = "guide_id", length = 64)
  private String guideId;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private User user;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "project_id", nullable = false)
  @OnDelete(action = OnDeleteAction.CASCADE)
  private Project project;

  /** 원본 업로드(히스토리 썸네일용). MVP 저장소 = image_blobs. 미저장 시 null. */
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "upload_id")
  @OnDelete(action = OnDeleteAction.SET_NULL)
  private ImageBlob upload;

  /** 대표 초점 축 id(primary_focus). */
  @Column(name = "primary_focus", length = 64)
  private String primaryFocus;

  @Column(name = "degraded", nullable = false)
  private boolean degraded;

  /** GuideResponse 전체(JSON). reference_ids 형태로 영속. */
  @Column(name = "payload", nullable = false, columnDefinition = "json")
  @JdbcTypeCode(SqlTypes.JSON)
  private GuideResponse payload;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;
}
