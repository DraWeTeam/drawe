import { useEffect, useState } from "react";
import { submitFeedback } from "./feedbackApi";
import styles from "./FeedbackModal.module.css";

// 백엔드 UserFeedbackRequest 의 @Size(max=2000) 과 일치.
const MAX_LEN = 2000;

const CloseIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M1.4 14L0 12.6L5.6 7L0 1.4L1.4 0L7 5.6L12.6 0L14 1.4L8.4 7L14 12.6L12.6 14L7 8.4L1.4 14Z"
      fill="currentColor"
    />
  </svg>
);

/**
 * 피드백 전송 모달 (SCR-GUIDE-02-3). 단일 자유서술 필드 — 별점·카테고리 없음.
 * 전송 성공 → onSubmitted(), 실패 → 인라인 에러 + 입력값 보존(재시도 가능).
 * X/배경 클릭 → onClose()(제출로 치지 않음).
 */
export default function FeedbackModal({
  sessionId,
  turnCount,
  onClose,
  onSubmitted,
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = value.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      await submitFeedback({ body: value.trim(), turnCount, sessionId });
      onSubmitted();
    } catch (err) {
      // 실패: 모달 유지 + 에러 표시 + 입력값 보존 → 재시도 가능
      setError(
        err.response?.data?.error?.message ||
          "전송에 실패했어요. 잠시 후 다시 시도해주세요.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        // 배경(dim) 직접 클릭일 때만 닫기 — 텍스트 드래그 후 바깥 릴리스로 닫히는 것 방지
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="피드백 전송"
    >
      <div className={styles.modal}>
        <header className={styles.header}>
          <h2 className={styles.title}>피드백 전송</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="닫기"
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.body}>
          <label className={styles.label} htmlFor="feedback-textarea">
            피드백 남기기
          </label>
          <textarea
            id="feedback-textarea"
            className={styles.textarea}
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, MAX_LEN))}
            placeholder="서비스에 대한 솔직한 후기를 남겨주세요 :)"
            maxLength={MAX_LEN}
            disabled={submitting}
            autoFocus
          />
          <div className={styles.meta}>
            {error ? <span className={styles.error}>{error}</span> : <span />}
            <span className={styles.counter}>
              {value.length} / {MAX_LEN}
            </span>
          </div>
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? "전송 중…" : "전송하기"}
          </button>
        </footer>
      </div>
    </div>
  );
}
