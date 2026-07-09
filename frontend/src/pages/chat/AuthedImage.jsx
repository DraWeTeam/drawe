import { useEffect, useState } from "react";
import api from "../login/api";

// blob:/data: 외에 절대(cross-origin) URL도 직접 로드한다.
// S3 presigned URL 은 쿼리 서명(X-Amz-...)으로 자체 인증하므로, JWT Authorization 헤더가 붙는
// api.get(XHR)로 가져가면 인증 메커니즘 충돌로 S3 가 400 을 준다(+CORS). 평범한 <img>로 로드.
// 외부 시드(Unsplash 등) 절대 URL 도 동일하게 인증 불필요.
// 상대 /images/{id}(HMAC 서명 유무 무관)는 XHR(baseURL=API)로 로드한다 — 서명이 붙어 있으면
// 백엔드가 서명을 우선 검증해 소유자와 무관하게 통과시키므로, 타인의 AI 이미지도 이 경로로 보인다.
// (프론트엔 /images 프록시가 없어 상대 URL 을 <img>로 직접 로드하면 프론트 origin 을 쳐 404 가 된다.)
const isDirectUrl = (s) =>
  !!s &&
  (s.startsWith("blob:") ||
    s.startsWith("data:") ||
    s.startsWith("http://") ||
    s.startsWith("https://"));

const AuthedImage = ({ src, alt, className, onClick }) => {
  // { url, failed } — src와 묶어 두면 src 변경 시 렌더에서 한 번에 리셋 가능
  const [state, setState] = useState({ src: null, url: null, failed: false });

  if (state.src !== src) {
    setState({ src, url: null, failed: false });
  }

  useEffect(() => {
    if (!src || isDirectUrl(src)) return;

    let revoked = false;
    let createdUrl = null;

    const load = async () => {
      try {
        const res = await api.get(src, { responseType: "blob" });
        if (revoked) return;
        createdUrl = URL.createObjectURL(res.data);
        setState((prev) =>
          prev.src === src ? { ...prev, url: createdUrl } : prev,
        );
      } catch {
        if (revoked) return;
        setState((prev) =>
          prev.src === src ? { ...prev, failed: true } : prev,
        );
      }
    };
    load();

    return () => {
      revoked = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src]);

  if (state.failed) {
    return <div className={className}>이미지를 불러오지 못했어요.</div>;
  }

  const resolvedUrl = isDirectUrl(src) ? src : state.url;
  if (!resolvedUrl) {
    return <div className={className} aria-busy="true" />;
  }
  return (
    <img
      src={resolvedUrl}
      alt={alt ?? ""}
      className={className}
      onClick={onClick}
    />
  );
};

export default AuthedImage;
