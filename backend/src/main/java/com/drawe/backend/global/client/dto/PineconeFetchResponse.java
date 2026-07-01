package com.drawe.backend.global.client.dto;

import java.util.Map;

/**
 * Pinecone {@code /vectors/fetch} 응답. {@code vectors} 는 id → 저장된 벡터 매핑.
 *
 * <p>SCRUM-112 — "[N]번 유사" 검색에서 이미 색인된 레퍼런스 이미지의 벡터를 재임베딩 없이 꺼내 쓰기 위함.
 */
public record PineconeFetchResponse(Map<String, PineconeVector> vectors, String namespace) {}
