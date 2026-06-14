package com.drawe.backend.domain.guide.dto;

import com.drawe.backend.global.client.dto.GuideResponse;
import java.util.List;

/**
 * 가이드 API 응답 = FastAPI {@link GuideResponse}(변형 없이 그대로) + Spring 보강.
 *
 * <p>guide 는 fastapi 응답 그대로(blocks 안에는 reference_ids). references 는 가이드 전체 블록에서
 * 등장한 reference_ids 를 *등장 순서*로 dedupe → 최대 3컷, 순번 1·2·3 + 이미지 URL 로 보강한 목록.
 */
public record GuideResult(GuideResponse guide, List<ResolvedReference> references) {}
