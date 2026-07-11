// src/analytics.js

// 현재 user_id를 모듈 내부에 보관 (App.jsx에서 setUserId로 주입)
let _userId = undefined;

export function setUserId(userId) {
  _userId = userId;
}

// 익명 ID (브라우저별 영구)
function getAnonymousId() {
  let id = localStorage.getItem("anonymous_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("anonymous_id", id);
  }
  return id;
}

// 세션 ID (탭 단위)
function getSessionId() {
  let id = sessionStorage.getItem("session_id");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("session_id", id);
    // 세션 시작 시각 — logout_completed 의 session_duration_sec 산출용.
    sessionStorage.setItem("session_started_at", String(Date.now()));
  }
  return id;
}

// 메인 트래킹 함수
export function track(eventName, properties = {}) {
  window.dataLayer = window.dataLayer || [];

  window.dataLayer.push({
    event: eventName,
    user_id: _userId,
    anonymous_id: getAnonymousId(),
    session_id: getSessionId(),
    platform: "web",
    timestamp: new Date().toISOString(),
    ...properties,
  });

  // 개발용 콘솔 로그
  if (import.meta.env.DEV) {
    console.log("[Analytics]", eventName, properties);
  }
}
