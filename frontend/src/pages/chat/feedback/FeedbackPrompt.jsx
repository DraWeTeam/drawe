import { useEffect, useState } from "react";
import { useFeedbackTrigger } from "./useFeedbackTrigger";
import { FEEDBACK_EVENTS, sendFeedbackEvent } from "./feedbackApi";
import FeedbackCard from "./FeedbackCard";
import FeedbackModal from "./FeedbackModal";
import styles from "./FeedbackPrompt.module.css";

/**
 * 채팅 흐름에 붙는 피드백 진입점 — 인라인 카드 + 모달 + 감사 토스트를 한데 묶는다.
 * ChatPage 는 이 컴포넌트 한 줄만 렌더하면 되므로 채팅 로직이 비대해지지 않는다.
 *
 * 트리거/오픈 이벤트만 프론트가 /analytics/events 로 발송한다. 제출(feedback_submitted)은
 * POST /feedback 처리 시 백엔드가 적재하므로 여기서 발송하지 않는다.
 */
export default function FeedbackPrompt({ messages, sessionId }) {
  const { turnCount, showCard, markSubmitted } = useFeedbackTrigger({
    messages,
    sessionId,
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  const openModal = () => {
    setModalOpen(true);
    sendFeedbackEvent(FEEDBACK_EVENTS.OPENED, { sessionId, turnCount });
  };

  const handleSubmitted = () => {
    markSubmitted(); // 세션 제출 플래그 → 카드 제거
    setModalOpen(false);
    setToastVisible(true);
  };

  useEffect(() => {
    if (!toastVisible) return;
    const t = setTimeout(() => setToastVisible(false), 3200);
    return () => clearTimeout(t);
  }, [toastVisible]);

  return (
    <>
      {showCard && (
        <div className={styles.cardSlot}>
          <FeedbackCard onClick={openModal} />
        </div>
      )}

      {modalOpen && (
        <FeedbackModal
          sessionId={sessionId}
          turnCount={turnCount}
          onClose={() => setModalOpen(false)}
          onSubmitted={handleSubmitted}
        />
      )}

      {toastVisible && (
        <div className={styles.toast} role="status">
          소중한 의견 감사합니다 :)
        </div>
      )}
    </>
  );
}
