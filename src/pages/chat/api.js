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
