import api from "../login/api";

// Content-Disposition 헤더의 filename 파싱. 없으면 null.
const filenameFromDisposition = (disposition) => {
  if (!disposition) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const ascii = /filename="?([^";]+)"?/i.exec(disposition);
  return ascii?.[1] || null;
};

// iOS(아이패드/아이폰) 판별 — iPadOS 13+ 는 데스크톱 UA 를 쓰므로 touch 점도 본다.
const isIOS = () => {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ : Mac UA + 터치스크린
  return ua.includes("Macintosh") && "ontouchend" in document;
};

/**
 * 이미지를 실제 파일로 다운로드한다 (출처 무관).
 *
 * 백엔드 GET /images/{id}/download 가 외부 URL 레퍼런스(Unsplash 등)는 프록시로 받아오고
 * 서버 저장 이미지는 바이트를 내려준다. 항상 Content-Disposition: attachment 라 진짜 다운로드가 된다.
 *
 * iOS Safari 는 <a download> 로 blob 저장이 제대로 안 되는 알려진 제약이 있어,
 * iOS 에선 blob 을 새 탭에 띄워 사용자가 "이미지 저장"(길게 누르기)으로 저장하게 한다.
 *
 * @returns {Promise<boolean>} 파일 다운로드 트리거 성공 여부
 */
// 상대 경로(/images/{id})를 새 탭으로 열면 프론트 오리진이라 공백 페이지가 된다.
//   폴백 새 탭은 자체 인증되는 절대 URL(presigned S3 등)일 때만 연다.
const isAbsoluteUrl = (u) => /^https?:\/\//i.test(u || "");

// 다운로드 blob 조회. /{id}/download 는 생성 이미지(Image 엔티티)용 — 완성작·업로드 원본은
//   ImageBlob 이라 404 가 난다. 그 경우 /{id}?download=true(ImageBlob + attachment)로 폴백.
const fetchDownloadBlob = async (imageId) => {
  try {
    return await api.get(`/images/${imageId}/download`, {
      responseType: "blob",
    });
  } catch {
    return await api.get(`/images/${imageId}`, {
      params: { download: true },
      responseType: "blob",
    });
  }
};

export const downloadImage = async (imageId, fallbackUrl) => {
  if (!imageId) {
    if (isAbsoluteUrl(fallbackUrl))
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    return false;
  }

  try {
    const res = await fetchDownloadBlob(imageId);

    const filename =
      filenameFromDisposition(res.headers["content-disposition"]) ||
      `image_${imageId}`;

    const blobUrl = window.URL.createObjectURL(res.data);

    if (isIOS()) {
      // iOS: 다운로드 대신 새 탭에 이미지 표시 → 사용자가 길게 눌러 "사진에 저장".
      // (Safari 는 a[download] 를 무시하고 blob: 을 그냥 네비게이트하므로 이 방식이 가장 확실)
      window.open(blobUrl, "_blank");
      // blobUrl 은 새 탭이 쓰므로 즉시 revoke 하지 않고 잠시 후 정리.
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
      return true;
    }

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
    return true;
  } catch (err) {
    console.error("이미지 다운로드 실패:", err);
    // 상대 경로 fallback 은 공백 새 탭이 되므로 절대 URL 일 때만 연다.
    if (isAbsoluteUrl(fallbackUrl))
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    return false;
  }
};
