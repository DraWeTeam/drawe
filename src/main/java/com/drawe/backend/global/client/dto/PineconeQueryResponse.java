package com.drawe.backend.global.client.dto;

import java.util.List;

public record PineconeQueryResponse(
        List<PineconeMatch> matches,
        String namespace
) {
}
