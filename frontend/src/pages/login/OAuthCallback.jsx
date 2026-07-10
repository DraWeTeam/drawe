import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
// 온보딩 비활성화: import { getOnboardingStatus } from "../onboarding/api";
import { track, setUserId } from "../../analytics";
import { useConsent } from "../../auth/ConsentContext";

function getUserIdFromToken(token) {
  try {
    return JSON.parse(atob(token.split(".")[1])).sub;
  } catch {
    return undefined;
  }
}

const OAuthCallback = () => {
  const navigate = useNavigate();
  const { refresh } = useConsent();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    console.log("OAuthCallback 진입");
    console.log("현재 URL:", window.location.href);

    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");

    // 온보딩 비활성화: 항상 /projects 로 이동
    const checkOnboardingAndRedirect = () => {
      navigate("/projects");
    };

    // 온보딩 비활성화 전 원본 — 재활성화 시 위 함수 대신 사용
    // const checkOnboardingAndRedirect = async () => {
    //   try {
    //     const status = await getOnboardingStatus();
    //     if (status.completed) {
    //       navigate("/projects");
    //     } else {
    //       navigate("/onboarding");
    //     }
    //   } catch (err) {
    //     console.error("온보딩 상태 조회 실패:", err);
    //     navigate("/projects"); // 에러 시 일단 프로젝트로
    //   }
    // };

    if (!accessToken || !refreshToken) {
      // ↓ OAuth 실패 (토큰 못 받음)
      track("login_failed", {
        login_method: "social",
        attempt_number: 1,
        error_type: "missing_tokens",
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
    track("login_success", {
      login_method: "social",
      attempt_count: 1,
      time_taken: 0,
    });

    // 약관 미동의(구글 신규 가입 등)면 동의 화면으로, 아니면 기존 분기
    refresh().then((agreed) => {
      if (agreed === false) {
        navigate("/terms");
      } else {
        checkOnboardingAndRedirect();
      }
    });
  }, [navigate, refresh]);
  return null;
};

export default OAuthCallback;
