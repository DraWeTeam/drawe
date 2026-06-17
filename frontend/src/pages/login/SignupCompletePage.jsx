import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const SignupCompletePage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      // 온보딩 비활성화: navigate("/onboarding");
      navigate("/projects");
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#fff",
        zIndex: 9999,
      }}
    >
      {/* 온보딩 비활성화 전 원본 문구:
        서비스를 시작하기 전, 딱 맞는 가이드를 제공하기 위해 한가지 질문에 답해주세요! */}
      <p style={{ color: "#888", marginBottom: "12px", fontSize: "14px" }}>
        잠시 후 서비스로 이동합니다.
      </p>
      <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>
        회원가입이 완료되었습니다.
      </h1>
    </div>
  );
};

export default SignupCompletePage;
