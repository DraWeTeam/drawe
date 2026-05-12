import { useEffect, useState } from "react";
import api from "../login/api";

const isDirectUrl = (s) =>
  !!s && (s.startsWith("blob:") || s.startsWith("data:"));

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
