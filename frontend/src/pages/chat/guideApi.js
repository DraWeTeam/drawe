// 한 끗 가이드 보조 API/리소스 헬퍼.
//
// TODO(백엔드 통합): 아래 주소·계약은 woz 프로토타입(FastAPI artcoach) 기준의 임시값이다.
//   실제로는 백엔드가 첨부 이미지로 의도를 분류해 가이드를 만들고, 레퍼런스 이미지·도식·
//   로드맵·피드백도 우리 백엔드(8080)를 통해 제공할 가능성이 크다.
//   통합이 확정되면 BASE 와 각 경로(/roadmap, /adopt, /image, /guide-asset)를 맞춰 수정할 것.
//   지금은 BASE 가 비어 있으면 호출을 건너뛰어 화면이 깨지지 않게 한다.
const BASE = (
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_GUIDE_API_BASE) ||
  ""
).replace(/\/+$/, "");

export const guideApiBase = () => BASE;

// 추천 레퍼런스 이미지 URL. reference 객체에 url 이 이미 있으면 그것을 우선 사용.
export const referenceImageUrl = (ref) => {
  if (!ref) return null;
  if (ref.url) return ref.url;
  if (!BASE || ref.id == null) return null;
  return `${BASE}/image/${encodeURIComponent(ref.id)}`;
};

// 한 끗 포인트 도식(SVG) URL.
export const guideAssetUrl = (refId) =>
  BASE && refId ? `${BASE}/guide-asset/${encodeURIComponent(refId)}` : null;

// 성장 흐름(로드맵) 조회. BASE 없으면 null 반환(미통합 상태).
export const getRoadmap = async (userId) => {
  if (!BASE) return null;
  const res = await fetch(
    `${BASE}/roadmap?user_id=${encodeURIComponent(userId || "anon")}`,
  );
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
};

// 레퍼런스 반응 로깅(👍/👎). 실패해도 화면을 막지 않는다.
export const adoptReference = async ({ guideId, referenceId, event }) => {
  if (!BASE) return;
  try {
    await fetch(`${BASE}/adopt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guide_id: guideId || "",
        reference_id: referenceId,
        persona: "",
        source_type: "",
        event, // "liked" | "disliked"
      }),
    });
  } catch {
    /* 피드백 로깅 실패는 무시 */
  }
};
