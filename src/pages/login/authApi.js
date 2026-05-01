import api from "./api";

export const signup = async ({ email, password, nickname }) => {
  const res = await api.post("/auth/signup", { email, password, nickname });
  return res.data.data;
};

export const checkEmail = async (email) => {
  const res = await api.get("/auth/check-email", { params: { email } });
  return res.data.data;
};

export const checkNickname = async (nickname) => {
  const res = await api.get("/auth/check-nickname", { params: { nickname } });
  return res.data.data;
};
