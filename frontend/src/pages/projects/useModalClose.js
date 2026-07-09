import { useCallback, useEffect, useState } from "react";

// 모달 닫힘 애니메이션 훅 — requestClose 호출 시 closing 을 켜고, delayMs 뒤 onClose 를 부른다.
//   backdrop/modal 에 closing 클래스를 붙여 pop-out/fade-out 을 재생한 뒤 실제 언마운트.
//   반환: { closing, requestClose }
export const useModalClose = (onClose, delayMs = 180) => {
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    setClosing(true);
  }, []);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => onClose?.(), delayMs);
    return () => clearTimeout(t);
  }, [closing, delayMs, onClose]);

  return { closing, requestClose };
};

export default useModalClose;
