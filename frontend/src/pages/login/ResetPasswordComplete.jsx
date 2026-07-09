import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./Login.module.css";
import AuthHeader from "./AuthHeader";

// SCR-AUTH-04 — 재설정 완료. 3초 후 로그인으로 이동.
const ResetPasswordComplete = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const id = setTimeout(() => navigate("/login", { replace: true }), 3000);
    return () => clearTimeout(id);
  }, [navigate]);

  return (
    <div className={styles.page}>
      <AuthHeader />
      <div
        className={styles.content}
        style={{ flexDirection: "column", textAlign: "center" }}
      >
        <p
          style={{
            fontSize: "16px",
            fontWeight: 500,
            color: "#4a4846",
            margin: "0 0 12px 0",
          }}
        >
          새로운 비밀번호로 재설정이 완료되었습니다.
        </p>
        <div style={{ fontWeight: 700, fontSize: "48px", color: "#0f0f0f" }}>
          비밀번호 재설정이 완료되었습니다.
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordComplete;
