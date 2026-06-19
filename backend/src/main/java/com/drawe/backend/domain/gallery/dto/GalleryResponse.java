package com.drawe.backend.domain.gallery.dto;

import java.util.List;

/** 완성작 갤러리 목록 응답. items/total/hasMore 페이징 계약. */
public record GalleryResponse(List<GalleryItem> items, long total, boolean hasMore) {}
