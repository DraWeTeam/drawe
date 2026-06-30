import api from "../login/api";

// 내 프로필 조회.
// 응답: { id, email, nickname, picture, termsAgreed, plan, social }
export const getProfile = async () => {
  const res = await api.get("/user/profile");
  return res.data.data;
};

// 닉네임 변경 → 갱신된 프로필 반환.
export const updateNickname = async (nickname) => {
  const res = await api.patch("/user/profile", { nickname });
  return res.data.data;
};

// 비밀번호 변경 (소셜 계정은 서버에서 거부).
export const changePassword = async (currentPassword, newPassword) => {
  await api.post("/user/password", { currentPassword, newPassword });
};

// 회원탈퇴 (soft delete).
export const withdraw = async () => {
  await api.delete("/user");
};

// 피드백 전송 — 운영 이메일로 전달 (서버는 저장하지 않음).
export const sendFeedback = async (message) => {
  await api.post("/user/feedback", { message });
};
