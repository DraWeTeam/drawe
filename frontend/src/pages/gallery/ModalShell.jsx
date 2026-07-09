import { useCallback, useEffect, useState } from "react";
import styles from "./CollectionDetailPage.module.css";

// 아카이브 모달 공통 셸 — 열림 시 pop-in, 닫힘 시 그 반대(pop-out)를 재생한 뒤 언마운트.
//   requestClose 를 자식/오버레이가 호출하면 닫힘 애니메이션 후 onClose 를 부른다.
//   busy(전송 중)면 닫기 요청을 무시한다.
//   children 은 (requestClose) => ReactNode 함수 — 취소/저장 버튼이 이 requestClose 를 쓴다.
const CLOSE_MS = 180; // CSS modal-pop-out / modal-fade-out 과 동일해야 함.

const ModalShell = ({
  onClose,
  busy = false,
  modalClassName = "",
  ariaLabel,
  children,
}) => {
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (busy) return;
    setClosing(true);
  }, [busy]);

  // 닫힘 애니메이션이 시작되면 CLOSE_MS 뒤 실제 언마운트(onClose).
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => onClose?.(), CLOSE_MS);
    return () => clearTimeout(t);
  }, [closing, onClose]);

  return (
    <div
      className={`${styles.modalOverlay} ${closing ? styles.modalOverlayClosing : ""}`}
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className={`${styles.modal} ${modalClassName} ${closing ? styles.modalClosing : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children(requestClose)}
      </div>
    </div>
  );
};

export default ModalShell;
