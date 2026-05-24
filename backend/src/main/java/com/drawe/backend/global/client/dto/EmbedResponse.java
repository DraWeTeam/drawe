package com.drawe.backend.global.client.dto;

import java.util.List;

public record EmbedResponse(List<Float> embedding, Integer dimension) {}
