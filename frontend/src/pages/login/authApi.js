import api from "./api";

export const signup = async ({
  email,
  password,
  nickname,
  agreeTerms,
  agreePrivacy,
  agreeAge,
}) => {
  const res = await api.post("/auth/signup", {
    email,
    password,
    nickname,
    agreeTerms,
    agreePrivacy,
    agreeAge,
  });
  return res.data.data;
};

// 이메일 인증번호 발송
export const sendEmailCode = async (email) => {
  const res = await api.post("/auth/email/send-code", { email });
  return res.data.data;
};

// 이메일 인증번호 검증
export const verifyEmailCode = async (email, code) => {
  const res = await api.post("/auth/email/verify-code", { email, code });
  return res.data.data;
};

// 약관 동의 기록 (로그인 상태 — 구글 가입/기존 회원용)
export const agreeTerms = async ({ agreeTerms, agreePrivacy, agreeAge }) => {
  const res = await api.post("/auth/agree-terms", {
    agreeTerms,
    agreePrivacy,
    agreeAge,
  });
  return res.data.data;
};

export const login = async ({ email, password }) => {
  const res = await api.post("/auth/login", { email, password });
  return res.data.data;
};

// 비밀번호 재설정 (SCR-AUTH-02~04) — 미가입/소셜 계정은 백엔드가 에러 반환.
export const sendPasswordResetCode = async (email) => {
  const res = await api.post("/auth/password-reset/send-code", { email });
  return res.data.data;
};

export const verifyPasswordResetCode = async (email, code) => {
  const res = await api.post("/auth/password-reset/verify-code", {
    email,
    code,
  });
  return res.data.data;
};

export const resetPassword = async (email, newPassword) => {
  const res = await api.post("/auth/password-reset", { email, newPassword });
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
