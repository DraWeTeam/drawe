import { useEffect, useState } from "react";
import api from "../login/api";

// blob:/data: 외에 절대(cross-origin) URL도 직접 로드한다.
// S3 presigned URL 은 쿼리 서명(X-Amz-...)으로 자체 인증하므로, JWT Authorization 헤더가 붙는
// api.get(XHR)로 가져가면 인증 메커니즘 충돌로 S3 가 400 을 준다(+CORS). 평범한 <img>로 로드.
// 외부 시드(Unsplash 등) 절대 URL 도 동일하게 인증 불필요. 상대 /images/{id} 만 XHR+JWT 경로 유지.
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
