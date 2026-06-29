import api from "../login/api";

// 레퍼런스 아카이브 — 프로젝트별 섹션 구조.
// 응답: { sections: [{ projectId, projectName, references: [{ imageId, url }] }] }
export const getReferenceArchive = async () => {
  const res = await api.get("/gallery/references");
  return res.data.data;
};

// 완성작 갤러리 — AI 생성 이미지 최신순 페이징.
// 응답: { items: [...], totalElements, hasMore }
export const getCompletedGallery = async ({ page = 0, size = 20 } = {}) => {
  const res = await api.get("/gallery/completed", { params: { page, size } });
  return res.data.data;
};
