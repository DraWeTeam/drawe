package com.drawe.backend.domain;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.ColumnDefault;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

/**
 * 아카이브 레퍼런스 컬렉션 — 명명된 레퍼런스 그룹(SCR-ARCH-01~06). 기존 {@link ProjectReference}(프로젝트 종속 flat)와 별개인 독립 계층.
 *
 * <p>{@code axis} 는 자동분류 축 id(예 {@code value_structure} — guideLabels.js AXIS_LABELS 동일 체계). NULL 이면 사용자가 직접 만든
 * 수동 컬렉션. {@code isSystem} 은 "미분류" 같은 자동 생성 시스템 컬렉션 플래그. {@code tags} 는 카드 태그칩(자동분류로 채우고 수정 모달에서 편집).
 */
@Getter
@Setter
@Entity
@Table(
    name = "collections",
    indexes = {@Index(name = "idx_coll_user", columnList = "user_id")},
    uniqueConstraints =
        @UniqueConstraint(
            name = "uk_coll_user_axis",
            columnNames = {"user_id", "axis"}))
public class Collection {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "id", nullable = false)
  private Long id;

  @NotNull
  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private User user;

  @Size(max = 100)
  @NotNull
  @Column(name = "name", nullable = false, length = 100)
  private String name;

  @Lob
  @Column(name = "description")
  private String description;

  /** 자동분류 축 id(taxonomy). NULL = 수동/미분류 컬렉션. 유저별 축당 하나(uk_coll_user_axis). */
  @Size(max = 40)
  @Column(name = "axis", length = 40)
  private String axis;

  /** 카드 태그칩. 자동분류로 채우고 SCR-ARCH-06 수정 모달에서 편집. */
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "tags", columnDefinition = "JSON")
  private List<String> tags = new ArrayList<>();

  /** "미분류" 등 자동 생성 시스템 컬렉션 여부. */
  @Column(name = "is_system", nullable = false)
  @ColumnDefault("false")
  private Boolean isSystem = false;

  @CreationTimestamp
  @Column(name = "created_at", updatable = false)
  private Instant createdAt;

  @UpdateTimestamp
  @Column(name = "updated_at")
  private Instant updatedAt;
}
