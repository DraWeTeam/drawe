import api from "../login/api";

export const uploadImage = async (file) => {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post("/images/upload", form);
  return res.data.data;
};

// TODO(백엔드 통합): 한 끗 가이드용 intent/medium 필드는 임시 계약이다.
//   백엔드가 첨부 이미지를 보고 의도를 분류해 FastAPI(artcoach) 가이드를 호출하는 구조가
//   확정되면 전달 방식(필드명·엔드포인트)이 바뀔 수 있으니, 그때 이 시그니처를 맞춰 수정할 것.
export const sendMessage = async (
  projectId,
  { message, sessionId, imageUrl, intent, medium },
) => {
  const body = { message };
  if (sessionId) body.sessionId = sessionId;
  if (imageUrl) body.imageUrl = imageUrl;
  if (intent) body.intent = intent; // open(작업중) | finished(완성작)
  if (medium) body.medium = medium; // ""(자동) | "sketch"(스케치)
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
