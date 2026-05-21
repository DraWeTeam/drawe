import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getOnboardingStatus } from "../onboarding/api";
import { track, setUserId } from "../../analytics"; 

function getUserIdFromToken(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).sub;
  } catch {
    return undefined;
  }
}

const OAuthCallback = () => {
  const navigate = useNavigate();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    console.log("OAuthCallback 진입");
    console.log("현재 URL:", window.location.href);

    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");

    const checkOnboardingAndRedirect = async () => {
      try {
        const status = await getOnboardingStatus();
        if (status.completed) {
          navigate("/projects");
        } else {
          navigate("/onboarding");
        }
      } catch (err) {
        console.error("온보딩 상태 조회 실패:", err);
        navigate("/projects"); // 에러 시 일단 프로젝트로
      }
    };

    if (!accessToken || !refreshToken) {
      // ↓ OAuth 실패 (토큰 못 받음)
      track('login_failed', {
        login_method: 'google',
        attempt_number: 1,
        error_type: 'missing_tokens',
      });
      console.log("토큰 없음, 로그인 페이지로 이동");
      navigate("/login");
      return;
    }

    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    console.log("localStorage 저장 완료");

    setUserId(getUserIdFromToken(accessToken));

    // ↓ OAuth 성공
    track('login_success', {
      login_method: 'google',
      attempt_count: 1,
      time_taken: 0,
    });

    // 온보딩 상태 체크 → 분기
    checkOnboardingAndRedirect();
  }, [navigate]);
  return null;
};

export default OAuthCallback;
