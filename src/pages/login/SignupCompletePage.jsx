import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const SignupCompletePage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/onboarding");
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#fff",
      zIndex: 9999
    }}>
      <p style={{ color: "#888", marginBottom: "12px", fontSize: "14px" }}>
        서비스를 시작하기 전, 딱 맞는 가이드를 제공하기 위해 한가지 질문에 답해주세요!
      </p>
      <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>
        회원가입이 완료되었습니다.
      </h1>
    </div>
  );
};

export default SignupCompletePage;