import api from "../login/api";

export const uploadImage = async (file) => {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post("/images/upload", form);
  return res.data.data;
};

export const sendMessage = async (
  projectId,
  { message, sessionId, imageUrl },
) => {
  const body = { message };
  if (sessionId) body.sessionId = sessionId;
  if (imageUrl) body.imageUrl = imageUrl;
  const res = await api.post(`/projects/${projectId}/chat`, body);
  return res.data.data;
};

export const getHistory = async (projectId, sessionId) => {
  const res = await api.get(`/projects/${projectId}/chat/${sessionId}/history`);
  return res.data.data;
};

export const getLatestSession = async (projectId) => {
  const res = await api.get(`/projects/${projectId}/chat/latest-session`);
  return res.data.data;
};

export const resetSession = async (projectId, sessionId) => {
  const res = await api.post(`/projects/${projectId}/chat/${sessionId}/reset`);
  return res.data.data;
};

export const generateImage = async (projectId, sessionId, prompt) => {
  const res = await api.post(
    `/projects/${projectId}/chat/${sessionId}/generate`,
    { prompt },
  );
  return res.data.data;
};

export const addPin = async (projectId, imageId) => {
  const res = await api.post(`/projects/${projectId}/pins`, { imageId });
  return res.data.data;
};

export const removePin = async (projectId, imageId) => {
  const res = await api.delete(`/projects/${projectId}/pins/${imageId}`);
  return res.data.data;
};

export const getPins = async (projectId) => {
  const res = await api.get(`/projects/${projectId}/pins`);
  return res.data.data;
};

/**
 * 한 끗 가이드(이미지 가이딩). 클립 업로드 이미지를 fastapi guide 서비스로 보내 코칭을 받는다.
 * 멀티파트: file(필수) + message/intent/track/medium(선택). 멱등은 Idempotency-Key 헤더.
 * 반환: GuideResult { guide: GuideResponse, references: [{ ordinal, refId, url }] }
 */
export const requestGuide = async (
  projectId,
  file,
  { message, intent, track, medium, requestId } = {},
) => {
  const form = new FormData();
  form.append("file", file);
  if (message) form.append("message", message);
  if (intent) form.append("intent", intent);
  if (track) form.append("track", track);
  if (medium) form.append("medium", medium);

  // Content-Type 은 axios 가 FormData 경계와 함께 자동 설정(직접 지정 금지).
  const headers = {
    "Idempotency-Key": requestId || crypto.randomUUID(),
  };
  const res = await api.post(`/projects/${projectId}/guide`, form, { headers });
  return res.data.data;
};

/** 프로젝트의 가이드 히스토리(오래된→최신). 채팅 재진입 시 카드 복원용. 반환: GuideResult[] */
export const getGuides = async (projectId) => {
  const res = await api.get(`/projects/${projectId}/guide`);
  return res.data.data;
};

/**
 * '생성 중' 레퍼런스 폴링. guide.pending_references[].job_id 로 호출.
 * 반환(정규화): { status: 'generating'|'ready'|'failed'|'unknown', refId, imagePath }
 * (Spring 이 fastapi /guide/ref-job/{jobId} 를 프록시 — ready 면 refId 로 이미지 표시.)
 */
export const getRefJob = async (projectId, jobId) => {
  const res = await api.get(`/projects/${projectId}/guide/ref-job/${jobId}`);
  const d = res.data.data || {};
  return {
    status: d.status,
    refId: d.refId ?? d.ref_id ?? null,
    imagePath: d.imagePath ?? d.image_path ?? null,
  };
};

/**
 * 가이드 내 레퍼런스 묶음 피드백(👍 liked / 👎 disliked).
 * 그 가이드가 보여준 레퍼런스(최대 3컷)에 이벤트가 기록된다. best-effort.
 */
export const sendReferenceFeedback = async (
  projectId,
  guideId,
  event,
  referenceIds,
) => {
  await api.post(
    `/projects/${projectId}/guide/${guideId}/references/feedback`,
    {
      event,
      referenceIds,
    },
  );
};

/**
 * 레퍼런스 재추천("다시 추천" 🔄). 저장 가이드의 축(subProblem)으로 새 컷을 받는다(LLM 미경유).
 * exclude = 화면에 이미 노출된 ref_id 전부(세션 누적, 서버 무상태). 반환:
 * { subProblem, exhausted, pendingMessage, references:[{ordinal,refId,url,sourceType,region,personas,category}] }.
 */
export const rerollReference = async (
  projectId,
  guideId,
  subProblem,
  exclude,
) => {
  const res = await api.post(
    `/projects/${projectId}/guide/${guideId}/references/reroll`,
    { subProblem, exclude },
  );
  return res.data.data;
};

/**
 * 가이드 전체 피드백(👍 like / 👎 dislike / 해제 null).
 * 사용자별 1행으로 수집되며, null 이면 토글 해제(삭제). best-effort.
 */
export const sendGuideFeedback = async (projectId, guideId, feedback) => {
  await api.post(`/projects/${projectId}/guide/${guideId}/feedback`, {
    feedback,
  });
};
