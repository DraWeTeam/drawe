import api from "../login/api";

export const createProject = async (payload) => {
  const res = await api.post("/projects", payload);
  return res.data.data;
};

export const getProjects = async ({ status, limit = 20, offset = 0 } = {}) => {
  const params = { limit, offset };
  if (status) params.status = status;
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
