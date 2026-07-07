import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import api from "../pages/login/api";

const ConsentContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useConsent = () => useContext(ConsentContext);

// 약관 동의 게이트에서 제외할(공개) 경로
const PUBLIC_PATHS = [
  "/landing",
  "/login",
  "/signup",
  "/oauth/callback",
  "/terms",
  "/policy",
];
const isPublicPath = (path) =>
  PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

// 프로필을 조회해 동의 상태를 계산. { status, agreed } 반환.
async function fetchConsentStatus() {
  const token = localStorage.getItem("accessToken");
  if (!token) return { status: "anon", agreed: null };
  try {
    const res = await api.get("/user/profile");
    const agreed = !!res.data.data.termsAgreed;
    return { status: agreed ? "ok" : "needsConsent", agreed };
  } catch {
    return { status: "anon", agreed: null };
  }
}

/**
 * 로그인 사용자의 약관 동의 여부를 전역으로 관리한다.
 * status: checking | anon | ok | needsConsent
 */
export function ConsentProvider({ children }) {
  // 토큰이 없으면 처음부터 anon (마운트 시 동기 setState 회피)
  const [status, setStatus] = useState(() =>
    localStorage.getItem("accessToken") ? "checking" : "anon",
  );

  // 프로필을 조회해 동의 여부를 갱신. 동의 여부(boolean) 또는 null(비로그인) 반환.
  const refresh = useCallback(async () => {
    const result = await fetchConsentStatus();
    setStatus(result.status);
    return result.agreed;
  }, []);

  useEffect(() => {
    let active = true;
    // 마운트 시 1회 확인 — setState는 await 이후에만 발생
    (async () => {
      const result = await fetchConsentStatus();
      if (active) setStatus(result.status);
    })();
    return () => {
      active = false;
    };
  }, []);

  const markAgreed = useCallback(() => setStatus("ok"), []);
  const markAnon = useCallback(() => setStatus("anon"), []);

  return (
    <ConsentContext.Provider value={{ status, refresh, markAgreed, markAnon }}>
      {children}
    </ConsentContext.Provider>
  );
}

/**
 * 로그인했지만 약관 미동의 상태면 /terms 로 강제 이동시키는 게이트.
 * 공개 경로/비로그인은 그대로 통과시킨다.
 */
export function ConsentGate({ children }) {
  const { status } = useConsent();
  const location = useLocation();
  const token = localStorage.getItem("accessToken");

  if (isPublicPath(location.pathname)) return children;
  if (!token) return children; // 비로그인은 각 페이지가 처리
  if (status === "checking") return null; // 첫 로드 시 프로필 확인 동안 잠깐 대기
  if (status === "needsConsent") return <Navigate to="/terms" replace />;
  return children;
}
