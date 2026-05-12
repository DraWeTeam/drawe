package com.drawe.backend.domain.image.service;

import com.drawe.backend.domain.User;

/**
 * 사용자가 업로드한 채팅용 이미지의 저장소 추상화.
 *
 * <p>현재 구현체: DbImageStorage. 향후 S3/Cloudinary 도입 시 구현체만 교체.
 */
public interface ImageStorage {

  /** 이미지 바이트와 mime 을 저장하고 식별자 반환. */
  Stored store(User owner, byte[] data, String mimeType);

  /** 식별자로 이미지를 조회. 소유자 검증은 호출 측 책임. */
  Loaded load(Long id);

  record Stored(Long id, String url) {}

  record Loaded(Long id, byte[] data, String mimeType, Long ownerId) {}
}
