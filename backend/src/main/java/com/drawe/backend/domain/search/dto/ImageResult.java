package com.drawe.backend.domain.search.dto;

import java.util.List;

public record ImageResult(
    Long id,
    String sourceId,
    String url,
    String photographerUsername,
    String photographerName,
    Float score,
    String technique,
    String subject,
    String mood,
    List<String> utility,
    List<String> freeTags,
    List<String> rawTags,
    /* ImageSource enum name: "UNSPLASH" | "AI". 프론트는 "AI"일 때 생성 이미지 배지를 렌더한다. */
    String source,
    /* AI 이미지의 영문 생성 프롬프트(Bria). Unsplash 는 null. rerank 에서 AI 의 내용 신호로 토큰화한다. */
    String prompt,
    /* Unsplash 네이티브 AI 캡션(문장). AI 이미지는 null(그쪽은 prompt). 레퍼런스/핀 설명의 핵심 내용 신호. */
    String aiDescription) {

  /** url 만 교체한 사본 — 브라우저 노출 전 s3:{key}→presigned 서명(ImageUrlSigner)에 쓴다. */
  public ImageResult withUrl(String newUrl) {
    return new ImageResult(
        id,
        sourceId,
        newUrl,
        photographerUsername,
        photographerName,
        score,
        technique,
        subject,
        mood,
        utility,
        freeTags,
        rawTags,
        source,
        prompt,
        aiDescription);
  }
}
