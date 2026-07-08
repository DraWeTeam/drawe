import { useState } from "react";
import { sendFeedback } from "../settings/api";
import { useToast } from "../../components/ToastContext";
import styles from "./FeedbackModal.module.css";

// 피드백 전송 모달 — 설정의 '피드백 보내기'와 동일한 기능(POST /user/feedback, 운영 이메일 전달).
//   채팅 10번째 토킹마다 제안되는 카드에서 열린다.
const FEEDBACK_MAX = 1000;

const FeedbackModal = ({ onClose }) => {
  const { showToast } = useToast();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const trimmed = message.trim();
  const valid = trimmed.length > 0 && trimmed.length <= FEEDBACK_MAX;

  const handleSend = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError("");
    try {
      await sendFeedback(trimmed);
      onClose();
      showToast({ message: "소중한 의견 감사합니다!" });
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          "전송에 실패했어요. 잠시 후 다시 시도해주세요.",
      );
      setSending(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={() => !sending && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h3 className={styles.title}>피드백 전송</h3>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <label className={styles.label}>피드백 남기기</label>
        <textarea
          className={styles.textarea}
          placeholder="서비스에 대한 솔직한 후기를 남겨주세요:)"
          maxLength={FEEDBACK_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          autoFocus
        />

        {error && <p className={styles.error}>{error}</p>}

        <button
          type="button"
          className={styles.submitBtn}
          onClick={handleSend}
          disabled={!valid || sending}
        >
          {sending ? "전송 중…" : "전송하기"}
        </button>
      </div>
    </div>
  );
};

export default FeedbackModal;
