import api from "../login/api";

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
