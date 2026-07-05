import api from "../login/api";

// SCRUM-113 — 키워드 검색 레퍼런스 보드.
// 채팅 기반 추천을 걷어내고 "키워드 → CLIP → 결과 + 좋아요/싫어요 피드백 루프"로 직결한다.
// 백엔드 계약: backend/docs/decisions/SCRUM-113-reference-board-frontend-contract.md

/**
 * 키워드 검색.
 * @param {number|string} projectId
 * @param {{ q?: string, source?: "ALL"|"AI"|"PHOTO"|"ARCHIVE", topK?: number }} opts
 * @returns {Promise<{ results: Array<{image: object, myReaction: "LIKE"|null}>, total: number, query: string, source: string }>}
 *
 * 백엔드가 자동 처리: 핀·싫어요·이번 세션에서 이미 노출한 이미지는 결과에서 제외된다.
 * q 가 비면 results: [] (프론트는 빈 상태 렌더).
 * topK 는 생략 시 백엔드 기본값(현재 10)을 사용한다.
 */
export const searchReferenceBoard = async (
  projectId,
  { q = "", source = "ALL", topK } = {},
) => {
  const params = { source };
  if (q) params.q = q;
  if (topK != null) params.topK = topK;
  const res = await api.get(`/projects/${projectId}/reference-board/search`, {
    params,
  });
  return res.data.data;
};

// 레퍼런스 생성 — 프롬프트 → bedrock 이미지 생성(source=AI Image 저장·인덱싱). 반환 { imageId, url }.
export const generateReference = async (projectId, prompt) => {
  const res = await api.post(
    `/projects/${projectId}/reference-board/generate`,
    {
      prompt,
    },
  );
  return res.data.data;
};

/**
 * 좋아요/싫어요/취소 공통 응답(ReactionResponse):
 *   { imageId, reaction: "LIKE"|"DISLIKE"|null, dislikeCount, suggestGeneration }
 * - 좋아요는 "반응"일 뿐 아카이브 적재가 아니다(아카이브 저장은 addReference).
 * - 싫어요한 이미지는 이후 검색에서 제외된다.
 * - suggestGeneration:true → 프론트가 "생성 유도 모달"을 띄운다.
 */
export const likeImage = async (projectId, imageId) => {
  const res = await api.post(
    `/projects/${projectId}/reference-board/images/${imageId}/like`,
  );
  return res.data.data;
};

export const dislikeImage = async (projectId, imageId) => {
  const res = await api.post(
    `/projects/${projectId}/reference-board/images/${imageId}/dislike`,
  );
  return res.data.data;
};

export const clearReaction = async (projectId, imageId) => {
  const res = await api.delete(
    `/projects/${projectId}/reference-board/images/${imageId}/reaction`,
  );
  return res.data.data;
};

/**
 * 생성 유도 모달 확인 — 세션 싫어요 카운터 리셋(다음 3회부터 다시 트리거).
 * 모달을 닫을 때 호출. 응답 data: { success: true }
 */
export const ackGenerationSuggestion = async (projectId) => {
  const res = await api.post(
    `/projects/${projectId}/reference-board/generation-suggestion/ack`,
  );
  return res.data.data;
};
