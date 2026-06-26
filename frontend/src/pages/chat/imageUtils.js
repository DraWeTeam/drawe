// ── Unsplash(imgix) 렌더링 리사이즈 ──
// DB의 레퍼런스 url 은 파라미터 없는 원본(3~5MB). 보드에 수십 장이 원본째 뜨면
// 디코드 지연/실패로 깨진 아이콘이 보인다. imgix 는 쿼리 파라미터로 서버사이드 리사이즈를
// 지원하므로, *렌더 시점에만* w/q 를 붙여 용량을 확 줄인다(DB 는 그대로).
//   - imgix(images.unsplash.com) 가 아니면 원본을 그대로 반환(안전).
//   - 이미 파라미터가 있으면 덮어쓰지 않고 그대로 둔다(멱등).
//   - fm=webp 명시(auto=format 의 AVIF 변환은 일부 이미지에서 브라우저 디코드 실패 →
//     onError 로 빈 카드가 됐다. webp 는 호환성이 넓고 용량도 충분히 작다).
export const unsplashSized = (url, width = 400) => {
  if (typeof url !== "string" || !url) return url;
  // imgix CDN 만 대상(다른 호스트/내부 /images/ 경로는 손대지 않음)
  if (!url.includes("images.unsplash.com")) return url;
  if (url.includes("?")) return url; // 이미 가공된 URL 은 존중
  const params = `w=${width}&q=75&fm=webp&fit=max`;
  return `${url}?${params}`;
};

export const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export const validateImageFile = (file) => {
  if (!file) return "파일이 비어있어요.";
  if (!ALLOWED_MIME.includes(file.type)) {
    return "이미지 파일만 첨부할 수 있어요 (jpg, png, webp, gif).";
  }
  if (file.size > MAX_BYTES) {
    return "어, 이건 너무 큰 것 같아요. 10MB 이하로 부탁해요!";
  }
  return null;
};

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });

export const resizeImage = async (file) => {
  // gif는 애니메이션 보존 위해 그대로 통과
  if (file.type === "image/gif") return file;

  const img = await loadImage(file);
  const longest = Math.max(img.width, img.height);
  if (longest <= MAX_EDGE) return file;

  const scale = MAX_EDGE / longest;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
    type: "image/jpeg",
  });
};
