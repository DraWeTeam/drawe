import api from "../login/api";

// 레퍼런스 아카이브 — 프로젝트별 섹션 구조.
// 응답: { sections: [{ projectId, projectName, references: [{ imageId, url }] }] }
export const getReferenceArchive = async () => {
  const res = await api.get("/gallery/references");
  return res.data.data;
};

// 레퍼런스 컬렉션 목록(SCR-ARCH-02) — 명명된 컬렉션 카드.
// 응답: { collections: [{ id, name, axis, tags:[], isSystem, count, thumbnails:[url] }] }
export const getCollections = async () => {
  const res = await api.get("/collections");
  return res.data.data;
};

// 컬렉션 상세(SCR-ARCH-04) — 헤더 + 레퍼런스 그리드.
// 응답: { id, name, description, axis, tags:[], isSystem,
//         references: [{ imageId, url, source, pinned }] }
export const getCollection = async (collectionId) => {
  const res = await api.get(`/collections/${collectionId}`);
  return res.data.data;
};

// 컬렉션 수정(SCR-ARCH-06) — 이름/설명/태그. tags 생략 시 미변경.
export const updateCollection = async (collectionId, { name, description, tags }) => {
  const res = await api.patch(`/collections/${collectionId}`, {
    name,
    description,
    tags,
  });
  return res.data.data;
};

// 컬렉션 삭제(SCR-ARCH-06) — 담긴 레퍼런스도 함께 삭제.
export const deleteCollection = async (collectionId) => {
  const res = await api.delete(`/collections/${collectionId}`);
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
