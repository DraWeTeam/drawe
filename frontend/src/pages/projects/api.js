import api from "../login/api";

// SCRUM-115 1단계 — 주제(topic)에서 프로젝트 이름 + 키워드 자동 추출.
// 응답: { name, keywords: string[] }  (Grok 실패 시 백엔드가 degrade)
export const extractKeywords = async (topic) => {
  const res = await api.post("/projects/keyword-extraction", { topic });
  return res.data.data;
};

// SCRUM-115 2단계 — 최종 편집된 { name, keywords }로 생성.
//   백엔드가 keywords 저장 + 백그라운드로 subject/mood/technique 분류.
export const createProject = async (payload) => {
  const res = await api.post("/projects", payload);
  return res.data.data;
};

export const getProjects = async ({
  q,
  status,
  sort,
  limit = 20,
  offset = 0,
} = {}) => {
  const params = { limit, offset };
  if (q) params.q = q;
  if (status) params.status = status;
  if (sort) params.sort = sort;
  const res = await api.get("/projects", { params });
  return res.data.data;
};

export const getProject = async (projectId) => {
  const res = await api.get(`/projects/${projectId}`);
  return res.data.data;
};

export const updateProject = async (projectId, payload) => {
  const res = await api.patch(`/projects/${projectId}`, payload);
  return res.data.data;
};

export const deleteProject = async (projectId) => {
  const res = await api.delete(`/projects/${projectId}`);
  return res.data.data;
};

// 이미지를 프로젝트에 핀(책갈피). 최대 3개. 응답: 핀 목록.
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

// 이미지를 프로젝트 레퍼런스 아카이브에 저장. 중복은 멱등 처리.
export const addReference = async (projectId, imageId) => {
  const res = await api.post(`/projects/${projectId}/references`, { imageId });
  return res.data.data;
};
