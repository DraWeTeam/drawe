package com.drawe.backend.domain;

import jakarta.persistence.Basic;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 사용자가 채팅에 첨부한 그림을 DB에 임시 저장하는 엔티티.
 *
 * <p>S3/Cloudinary 도입 전까지의 MVP 저장소. ImageStorage 추상화 뒤에 숨겨져 있어 향후 구현체만 교체하면 됨.
 *
 * <p>data 컬럼은 LAZY — 메시지 목록 조회 시 BLOB 까지 끌어오지 않도록.
 */
@Getter
@Setter
@Entity
@Table(
    name = "image_blobs",
    indexes = {@Index(name = "idx_image_blob_user_created", columnList = "user_id, created_at")})
public class ImageBlob {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "id", nullable = false)
  private Long id;

  @NotNull
  @Basic(fetch = FetchType.LAZY)
  @Column(name = "data", nullable = false, columnDefinition = "MEDIUMBLOB")
  private byte[] data;

  @NotNull
  @Size(max = 50)
  @Column(name = "mime_type", nullable = false, length = 50)
  private String mimeType;

  @NotNull
  @Column(name = "size_bytes", nullable = false)
  private Integer sizeBytes;

  @NotNull
  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private User user;

  @CreationTimestamp
  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;
}
