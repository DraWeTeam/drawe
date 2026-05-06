package com.drawe.backend.global.client.dto;

import java.util.List;

public record PineconeQueryRequest(
        List<Float> vector,
        Integer topK,
        Boolean includeValues,
        Boolean includeMetadata
) {
    public static PineconeQueryRequest of(List<Float> vector, int topK){
        return new PineconeQueryRequest(vector, topK, false, false);
    }
}
