import api from "../../login/api";

// 백엔드 화이트리스트와 1:1 (AnalyticsEventController.ALLOWED / AnalyticsEventType).
export const FEEDBACK_EVENTS = {
  TRIGGERED: "feedback_modal_triggered",
  OPENED: "feedback_modal_opened",
  SUBMITTED: "feedback_submitted",
};

/**
 * 사용자 자유서술 피드백 제출. POST /feedback → { body, turnCount, sessionId }.
 * 성공 시 백엔드가 feedback_submitted analytics 를 적재하므로 프론트에서 중복 발송하지 않는다.
 * 반환: { id }.
 */
export const submitFeedback = async ({ body, turnCount, sessionId }) => {
  const payload = { body };
  if (turnCount != null) payload.turnCount = turnCount;
  if (sessionId) payload.sessionId = sessionId;
  const res = await api.post("/feedback", payload);
  return res.data.data;
};

/**
 * 피드백 깔때기 이벤트(triggered / opened) 적재. best-effort — 실패해도 UI 흐름을 막지 않는다.
 * (submitted 는 /feedback 처리 시 백엔드가 적재하므로 여기서 보내지 않는다.)
 */
export const sendFeedbackEvent = async (
  eventType,
  { sessionId, turnCount } = {},
) => {
  try {
    await api.post("/analytics/events", { eventType, sessionId, turnCount });
  } catch {
    // 분석 이벤트 실패는 조용히 무시 (사용자 흐름 비차단)
  }
};
