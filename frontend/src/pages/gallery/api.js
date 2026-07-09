import api from "../login/api";

// 레퍼런스 아카이브 — 프로젝트별 섹션 구조.
// 응답: { sections: [{ projectId, projectName, references: [{ imageId, url }] }] }
export const getReferenceArchive = async () => {
  const res = await api.get("/gallery/references");
  return res.data.data;
};

// 레퍼런스 컬렉션 목록(SCR-ARCH-02) — 명명된 컬렉션 카드.
// 응답: { collections: [{ id, name, tags:[], count, thumbnails:[url] }] }
export const getCollections = async () => {
  const res = await api.get("/collections");
  return res.data.data;
};

// 컬렉션 상세(SCR-ARCH-04) — 헤더 + 레퍼런스 그리드.
// 응답: { id, name, description, tags:[],
//         references: [{ imageId, url, source, pinned, addedAt, keywords:[] }] }
export const getCollection = async (collectionId) => {
  const res = await api.get(`/collections/${collectionId}`);
  return res.data.data;
};

// 레퍼런스 상세(SCR-ARCH-05 전체화면) — 원본/이름/출처/키워드/내 반응.
// 응답: { imageId, url, source, name, sourceUrl, keywords:[], myReaction: "LIKE"|"DISLIKE"|null }
export const getReferenceDetail = async (imageId) => {
  const res = await api.get(`/collections/reference/${imageId}`);
  return res.data.data;
};

// 레퍼런스 반응(SCR-ARCH-05 마음에들어요/별로예요) — 이미지 단위 피드백(projectId 무관).
//   type = "LIKE" | "DISLIKE". 같은 반응 재클릭은 상위에서 취소로 처리.
export const saveImageFeedback = async (imageId, type) => {
  const res = await api.post(`/images/${imageId}/feedback`, { type });
  return res.data.data;
};

export const removeImageFeedback = async (imageId) => {
  const res = await api.delete(`/images/${imageId}/feedback`);
  return res.data.data;
};

// 컬렉션 수정(SCR-ARCH-06) — 이름/설명/태그. tags 생략 시 미변경.
export const updateCollection = async (
  collectionId,
  { name, description, tags },
) => {
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

// 새 컬렉션 생성 — '아카이브 추가(+)' / '직접 추가하기'. imageIds·tags 는 선택(이미지 없이도 생성).
// 응답: { collectionId }
export const createCollection = async ({ name, imageIds, tags }) => {
  const res = await api.post("/collections", { name, imageIds, tags });
  return res.data.data;
};

// 카드 ⋮ '아카이브' 서브메뉴 — 내 컬렉션 목록 + 이 이미지가 이미 담긴 여부(체크 표시용).
// 응답: { collections: [{ id, name, count, contained }] }
export const getArchiveTargets = async (imageId) => {
  const res = await api.get(`/collections/reference/${imageId}/targets`);
  return res.data.data;
};

// 레퍼런스 저장(SCR-ARCH-05 아카이브) — 이미지를 컬렉션에 담기(멱등).
export const addReferenceToCollection = async (collectionId, imageId) => {
  const res = await api.post(`/collections/${collectionId}/references`, {
    imageId,
  });
  return res.data.data;
};

// 아카이브 취소(카드 ⋮) — 컬렉션에서 레퍼런스 제거.
export const removeReferenceFromCollection = async (collectionId, imageId) => {
  const res = await api.delete(
    `/collections/${collectionId}/references/${imageId}`,
  );
  return res.data.data;
};

// 정보 수정(카드 ⋮) — 레퍼런스의 사용자 태그 수정 및 다른 컬렉션으로 이동(둘 다 선택).
//   targetCollectionId=null 이면 태그만 저장, userTags=null 이면 태그 미변경.
export const updateReferenceInfo = async (
  collectionId,
  imageId,
  { targetCollectionId = null, userTags = null } = {},
) => {
  const res = await api.patch(
    `/collections/${collectionId}/references/${imageId}/move`,
    { targetCollectionId, userTags },
  );
  return res.data.data;
};

// 고정하기 토글(카드 ⋮).
export const togglePin = async (collectionId, imageId) => {
  const res = await api.post(
    `/collections/${collectionId}/references/${imageId}/pin`,
  );
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
