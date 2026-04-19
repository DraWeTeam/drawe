import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const OAuthCallback = () => {
  const navigate = useNavigate();
  const hasRun = useRef(false);

  useEffect(() => {
    if(hasRun.current) return;
    hasRun.current = true;

    console.log("OAuthCallback 진입");
    console.log("현재 URL:", window.location.href);

    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");

    if (accessToken && refreshToken) {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      console.log("localStorage 저장 완료");
      navigate("/");
    } else {
      console.log("토큰 없음, 로그인 페이지로 이동");
      navigate("/login");
    }
  }, [navigate]);
  
  return null;
};

export default OAuthCallback;