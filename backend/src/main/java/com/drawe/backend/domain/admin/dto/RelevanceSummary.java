package com.drawe.backend.domain.admin.dto;

/**
 * 추천 적합도 요약 — "사용자가 원하는 대로 ref가 제공됐나"의 윈도우 단위 집계.
 *
 * <p>shown = 윈도우 내 ref 노출 총합(JSON_TABLE unnest). likes/dislikes/saves = 같은 윈도우의 피드백·저장 총합. rate는 노출
 * 대비(of shown). decisionKeep/Skip은 키워드-추출 단계의 *시스템* 결정(재검색 여부)이라 "유저 거부"가 아님 — 참고용.
 */
public record RelevanceSummary(
    long shown,
    long likes,
    long dislikes,
    long saves,
    Double likeRate,
    Double dislikeRate,
    Double saveRate,
    long decisionKeep,
    long decisionSkip) {}
