package com.drawe.backend.domain.guide.dto;

import com.drawe.backend.global.client.dto.GuideResponse;
import java.time.Instant;
import java.util.List;

/**
 * 가이드 API 응답 = FastAPI {@link GuideResponse}(변형 없이 그대로) + Spring 보강.
 *
 * <p>guide 는 fastapi 응답 그대로(blocks 안에는 reference_ids). references 는 가이드 전체 블록에서 등장한 reference_ids 를
 * *등장 순서*로 dedupe → 최대 3컷, 순번 1·2·3 + 이미지 URL 로 보강한 목록.
 *
 * <p>requestText = 사용자가 업로드와 함께 보낸 질문(주황 말풍선). 히스토리 복원 시 가이드 카드 앞에 재구성. 없으면 null.
 */
public record GuideResult(
    GuideResponse guide,
    List<ResolvedReference> references,
    Instant createdAt,
    String uploadUrl,
    String requestText) {}
