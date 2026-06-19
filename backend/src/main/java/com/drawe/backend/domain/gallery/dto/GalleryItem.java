package com.drawe.backend.domain.gallery.dto;

import com.drawe.backend.domain.Image;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/** 완성작 갤러리 항목. url 은 {@code Image.url}(저장 경로)을 그대로 노출한다(이미지 서빙은 GET /images/{id} 가 담당). */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record GalleryItem(Long id, String url, String prompt, Instant createdAt) {

  public static GalleryItem of(Image image) {
    return new GalleryItem(
        image.getId(), image.getUrl(), image.getPrompt(), image.getCreatedAt());
  }
}
