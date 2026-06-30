import api from "../login/api";

// 전역 검색 (SearchModal) — 대상별 키워드 검색. SCRUM-105.
// scope: "ALL" | "PROJECT" | "REFERENCE" | "COMPLETED"
// 응답: { projects:[...], references:[...], completed:[...] }
export const globalSearch = async ({ q, scope = "ALL", limit = 10 } = {}) => {
  const params = { scope, limit };
  if (q) params.q = q;
  const res = await api.get("/search", { params });
  return res.data.data;
};
