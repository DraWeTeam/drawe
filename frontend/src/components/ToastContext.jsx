import { createContext, useCallback, useContext, useRef, useState } from "react";
import styles from "./Toast.module.css";

// 전역 토스트 — 화면 상단 중앙에 잠깐 떴다 사라지는 알림.
//   useToast().showToast({ message, actionLabel, onAction, duration }) 로 호출.
//   actionLabel/onAction 을 주면 '실행 취소' 같은 액션 버튼이 붙는다.
const ToastContext = createContext(null);

// 어디서든(Provider 밖 포함) 안전하게 쓰도록 훅은 항상 함수를 반환한다.
export const useToast = () => {
  const ctx = useContext(ToastContext);
  return ctx ?? { showToast: () => {}, dismissToast: () => {} };
};

const DEFAULT_DURATION = 5000;

export const ToastProvider = ({ children }) => {
  const [toast, setToast] = useState(null); // { id, message, actionLabel, onAction }
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef(null);
  const idRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const dismissToast = useCallback(() => {
    clearTimer();
    // 퇴장 애니메이션 후 제거.
    setLeaving(true);
    setTimeout(() => {
      setToast(null);
      setLeaving(false);
    }, 200);
  }, []);

  const showToast = useCallback(
    ({ message, actionLabel, onAction, duration = DEFAULT_DURATION } = {}) => {
      if (!message) return;
      clearTimer();
      idRef.current += 1;
      setLeaving(false);
      setToast({ id: idRef.current, message, actionLabel, onAction });
      timerRef.current = setTimeout(() => dismissToast(), duration);
    },
    [dismissToast],
  );

  const handleAction = () => {
    const fn = toast?.onAction;
    dismissToast();
    fn?.();
  };

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {toast && (
        <div className={styles.viewport} aria-live="polite">
          <div
            className={`${styles.toast} ${leaving ? styles.leaving : ""}`}
            role="status"
          >
            <span className={styles.message}>{toast.message}</span>
            {toast.actionLabel && (
              <button
                type="button"
                className={styles.action}
                onClick={handleAction}
              >
                {toast.actionLabel}
              </button>
            )}
            <button
              type="button"
              className={styles.close}
              onClick={dismissToast}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
};
