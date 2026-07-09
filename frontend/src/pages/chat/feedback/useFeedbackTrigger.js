import { useCallback, useEffect, useMemo, useState } from "react";
import { FEEDBACK_EVENTS, sendFeedbackEvent } from "./feedbackApi";

// ─────────────────────────────────────────────────────────────
// 인라인 피드백 카드 노출 임계 턴 수. 노출 시점을 바꾸려면 이 값만 조정한다.
// 턴 = (사용자 메시지 1 + AI 응답 1) 1쌍.
export const FEEDBACK_TRIGGER_TURNS = 15;
// ─────────────────────────────────────────────────────────────

// 세션 스코프 플래그 — sessionStorage(탭 단위)에 저장한다. 새로고침엔 유지되되
// localStorage 처럼 브라우저에 영구 누적되지 않아, "같은 세션에서만 재노출 안 함"에 맞다.
const triggeredKey = (sid) => `drawe_feedback_triggered_${sid}`;
const submittedKey = (sid) => `drawe_feedback_submitted_${sid}`;

// 실제 AI '응답'만 카운트 — 생성/가이드 로딩·에러 placeholder 는 아직 완료된 턴이 아니다.
const isAssistantResponse = (m) =>
  m.role === "assistant" &&
  !m._generating &&
  m.type !== "guideLoading" &&
  m.type !== "guideError";

/**
 * 완료된 (사용자 → AI) 쌍의 개수 = 턴 수.
 * 기존 ChatPage 는 iteration 을 사용자 메시지 수로 세지만, 여기선 "사용자+AI=1턴" 정의에 맞춰
 * 앞선 사용자 메시지에 대응한 AI 응답이 도착한 쌍만 센다. 채팅 히스토리는 서버에서 복원되므로
 * 새로고침에도 값이 안정적이다.
 */
export const countCompletedTurns = (messages) => {
  let pendingUser = 0;
  let turns = 0;
  for (const m of messages) {
    if (m.role === "user") {
      pendingUser += 1;
    } else if (isAssistantResponse(m) && pendingUser > 0) {
      turns += 1;
      pendingUser -= 1;
    }
  }
  return turns;
};

/**
 * 피드백 트리거 상태. 15턴 도달 + 미제출 세션이면 인라인 카드를 노출하고,
 * 세션당 1회 feedback_modal_triggered 를 발송한다.
 */
const readSubmitted = (sid) =>
  !!sid && sessionStorage.getItem(submittedKey(sid)) === "1";

export function useFeedbackTrigger({ messages, sessionId }) {
  const turnCount = useMemo(() => countCompletedTurns(messages), [messages]);

  const [submitted, setSubmitted] = useState(() => readSubmitted(sessionId));

  // 세션이 바뀌면(널→복원 포함) 제출 여부를 sessionStorage 로 재동기화한다.
  // effect 대신 렌더 중 조정(React 권장 패턴) — 새 세션 값이 즉시 반영되고 cascading render 없음.
  const [trackedSid, setTrackedSid] = useState(sessionId);
  if (sessionId !== trackedSid) {
    setTrackedSid(sessionId);
    setSubmitted(readSubmitted(sessionId));
  }

  const showCard =
    !!sessionId && turnCount >= FEEDBACK_TRIGGER_TURNS && !submitted;

  // 임계 도달 시 feedback_modal_triggered 를 세션당 1회만 발송(플래그로 재발송 차단).
  useEffect(() => {
    if (!showCard) return;
    const key = triggeredKey(sessionId);
    if (sessionStorage.getItem(key) === "1") return;
    sessionStorage.setItem(key, "1");
    sendFeedbackEvent(FEEDBACK_EVENTS.TRIGGERED, { sessionId, turnCount });
  }, [showCard, sessionId, turnCount]);

  const markSubmitted = useCallback(() => {
    if (sessionId) sessionStorage.setItem(submittedKey(sessionId), "1");
    setSubmitted(true);
  }, [sessionId]);

  return { turnCount, showCard, submitted, markSubmitted };
}
