import { useEffect, useState } from "react";
import api from "../login/api";

const AuthedImage = ({ src, alt, className, onClick }) => {
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) return;

    if (src.startsWith("blob:") || src.startsWith("data:")) {
      setObjectUrl(src);
      return;
    }

    let revoked = false;
    let createdUrl = null;
    setFailed(false);

    const load = async () => {
      try {
        const res = await api.get(src, { responseType: "blob" });
        if (revoked) return;
        createdUrl = URL.createObjectURL(res.data);
        setObjectUrl(createdUrl);
      } catch {
        if (!revoked) setFailed(true);
      }
    };
    load();

    return () => {
      revoked = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src]);

  if (failed) {
    return <div className={className}>이미지를 불러오지 못했어요.</div>;
  }
  if (!objectUrl) {
    return <div className={className} aria-busy="true" />;
  }
  return (
    <img src={objectUrl} alt={alt ?? ""} className={className} onClick={onClick} />
  );
};

export default AuthedImage;
