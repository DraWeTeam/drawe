export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
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
