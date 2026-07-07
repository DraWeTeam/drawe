package com.drawe.backend.domain.guide.dto;

import java.util.List;

/**
 * 레퍼런스 재추천("다시 추천" 🔄) 요청. subProblem = 재추천할 축(가이드 블록에 실제 존재해야 함), exclude = 화면에 이미 노출된 ref_id
 * 전부(초기 top-3 포함, 프론트 세션 누적). 서버 무상태 — 매 요청 전달.
 */
public record RerollRequest(String subProblem, List<String> exclude) {}
