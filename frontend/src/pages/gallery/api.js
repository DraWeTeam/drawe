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

// 완성작 상세(ARCH-07) — 프로젝트 단위 통계·타임라인·과정·질문성장 번들(백엔드 직집계).
// 응답: { overview, weeklyTrend:[{group,points:[{label,count}]}], recurringTop:[axisId],
//        improvedItems:[axisId], timeline:[...], processGallery:[...], topReferences:[...],
//        questionGrowth:[{phase,date,text}], summary:{axisId,firstWeekHits,lastWeekHits}|null }
export const getCompletedDetail = async (projectId) => {
  const res = await api.get(`/gallery/completed/${projectId}`);
  return res.data.data;
};
