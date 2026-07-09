import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import styles from "./Login.module.css";
import AuthHeader from "./AuthHeader";
import { resetPassword } from "./authApi";

// SCR-AUTH-03 — 비밀번호 재설정. 인증 없이 직접 진입 차단(이전 단계에서 넘긴 email 없으면 리다이렉트).
const ResetPassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // 인증 단계를 거치지 않은 직접 진입 차단
    if (!email) navigate("/login", { replace: true });
  }, [email, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 해요.");
      return;
    }
    if (password !== confirm) {
      setError("비밀번호가 일치하지 않아요.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(email, password);
      navigate("/reset-password/complete", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error?.message || "재설정에 실패했어요.");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = password.length >= 8 && password === confirm && !submitting;

  // 인증 안 거친 직접 진입은 폼을 렌더하지 않음(useEffect 가 로그인으로 리다이렉트).
  if (!email) return null;

  return (
    <div className={styles.page}>
      <AuthHeader />
      <div className={styles.content}>
        <div className={styles.wrapper}>
          <div className={styles.section}>
            <div style={{ fontWeight: "bold", fontSize: "36px" }}>
              비밀번호 재설정
            </div>
            <p
              style={{
                fontSize: "14px",
                color: "#4a4846",
                margin: "12px 0 0 0",
              }}
            >
              새로운 비밀번호를 입력해주세요.
            </p>
          </div>
          <form className={styles.loginBox} onSubmit={handleSubmit}>
            <div style={{ marginBottom: "18px" }}>
              <p className={styles.loginValue}>비밀번호</p>
              <input
                type="password"
                className={styles.infoItem}
                placeholder="8자 이상 입력해주세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: "40px" }}>
              <p className={styles.loginValue}>비밀번호 재확인</p>
              <input
                type="password"
                className={styles.infoItem}
                placeholder="비밀번호를 다시 입력해주세요"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            {error && (
              <p
                style={{ color: "red", fontSize: "14px", margin: "0 0 16px 0" }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              className={styles.loginBtn}
              disabled={!canSubmit}
              style={{
                backgroundColor: canSubmit ? "#ff8534" : "#d8d7d5",
                cursor: canSubmit ? "pointer" : "not-allowed",
              }}
            >
              {submitting ? "처리 중..." : "재설정하기"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
