package com.drawe.backend.domain.guide.dto;

import java.util.List;

/**
 * 재추천 결과. 세 상태 중 하나:
 *
 * <ul>
 *   <li>정상: exhausted=false, pendingMessage=null, references=새 컷(최대 3, badge 메타 포함)
 *   <li>고갈: exhausted=true, references=[] — 프론트가 정직 안내 + 🔄 비활성
 *   <li>생성 중(AI 적격 축): exhausted=false, pendingMessage!=null — 기존 "생성 중" 흐름
 * </ul>
 */
public record RerollResult(
    String subProblem,
    boolean exhausted,
    String pendingMessage,
    List<ResolvedReference> references) {

  public static RerollResult ok(String subProblem, List<ResolvedReference> references) {
    return new RerollResult(subProblem, false, null, references);
  }

  public static RerollResult exhausted(String subProblem) {
    return new RerollResult(subProblem, true, null, List.of());
  }

  public static RerollResult pending(String subProblem, String message) {
    return new RerollResult(subProblem, false, message, List.of());
  }
}
