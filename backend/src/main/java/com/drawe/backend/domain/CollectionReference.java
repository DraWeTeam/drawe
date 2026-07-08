package com.drawe.backend.domain;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.ColumnDefault;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 컬렉션 ↔ 이미지 매핑. {@code pinned} = SCR-ARCH-05 카드 "고정하기". (collection_id, image_id) 유니크로 멱등 저장.
 */
@Getter
@Setter
@Entity
@Table(
    name = "collection_references",
    indexes = {@Index(name = "idx_collref_image", columnList = "image_id")},
    uniqueConstraints =
        @UniqueConstraint(
            name = "uk_collref_coll_image",
            columnNames = {"collection_id", "image_id"}))
public class CollectionReference {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "id", nullable = false)
  private Long id;

  @NotNull
  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "collection_id", nullable = false)
  private Collection collection;

  @NotNull
  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "image_id", nullable = false)
  private Image image;

  @Column(name = "pinned", nullable = false)
  @ColumnDefault("false")
  private Boolean pinned = false;

  /**
   * 사용자가 이 레퍼런스(컬렉션 내)에 직접 단 태그. SCR-ARCH-05 카드 ⋮ '정보 수정'에서 편집. 자동분류 컬렉션 태그와 별개인 이미지 단위 사용자 태그.
   */
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "user_tags", columnDefinition = "JSON")
  private List<String> userTags = new ArrayList<>();

  @CreationTimestamp
  @Column(name = "added_at", updatable = false)
  private Instant addedAt;
}
