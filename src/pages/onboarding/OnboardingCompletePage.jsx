import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../login/api";

const OnboardingCompletePage = () => {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState("");

  useEffect(() => {
    // 유저 정보 호출
    api.get("/user/profile")
      .then(res => setNickname(res.data.data.nickname))
      .catch(() => setNickname(""));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/projects");
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
        DraWe를 이용하기 위한 모든 준비가 완료되었습니다!
      </p>
      <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>
        {nickname}님 환영합니다!
      </h1>
    </div>
  );
};

export default OnboardingCompletePage;