package com.drawe.backend.domain.gallery.dto;

import com.drawe.backend.domain.Project;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * 완성작 갤러리 항목 — 완성(COMPLETED) 처리된 프로젝트의 완성 그림.
 *
 * <p>drawingUrl 은 업로드 완성 그림의 서빙 경로({@code /images/{blobId}})다. 썸네일/다운로드 모두 이 경로로 처리된다.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record GalleryItem(
    Long projectId, String projectName, String drawingUrl, Instant completedAt) {

  public static GalleryItem of(Project project) {
    return new GalleryItem(
        project.getId(), project.getName(), project.getDrawingUrl(), project.getUpdatedAt());
  }
}
