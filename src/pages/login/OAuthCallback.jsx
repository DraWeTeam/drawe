import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getOnboardingStatus } from "../onboarding/api";

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

    if (!accessToken || !refreshToken) {
      console.log("토큰 없음, 로그인 페이지로 이동");
      navigate("/login");
      return;
    }

    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    console.log("localStorage 저장 완료");

    // 온보딩 상태 체크 → 분기
    checkOnboardingAndRedirect();
  }, [navigate]);

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

  return null;
};

export default OAuthCallback;
