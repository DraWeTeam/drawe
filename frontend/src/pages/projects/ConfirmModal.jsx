import { useState } from "react";
import { useModalClose } from "./useModalClose";
import styles from "./ConfirmModal.module.css";

const ConfirmModal = ({
  title,
  description,
  confirmLabel = "확인",
  cancelLabel = "취소",
  onConfirm,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  // 닫힘 애니메이션 — 취소/배경/확인 성공 시 pop-out 후 실제 onClose.
  const { closing, requestClose } = useModalClose(onClose);

  const handleConfirm = async () => {
    setErrorMessage("");
    setLoading(true);
    try {
      await onConfirm();
      requestClose(); // 성공 시 닫힘 애니메이션 후 언마운트.
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "요청에 실패했습니다.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    if (loading) return;
    requestClose();
  };

  return (
    <div
      className={`${styles.backdrop} ${closing ? styles.backdropClosing : ""}`}
      onClick={close}
    >
      <div
        className={`${styles.modal} ${closing ? styles.modalClosing : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.title}>{title}</h2>
        {description && <p className={styles.desc}>{description}</p>}
        {errorMessage && <p className={styles.error}>{errorMessage}</p>}
        <div className={styles.actions}>
          <button
            type="button"
            onClick={close}
            className={styles.cancelBtn}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={styles.confirmBtn}
            disabled={loading}
          >
            {loading ? "처리 중..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
