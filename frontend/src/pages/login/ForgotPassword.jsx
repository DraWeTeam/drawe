import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./Login.module.css";
import AuthHeader from "./AuthHeader";
import { sendPasswordResetCode, verifyPasswordResetCode } from "./authApi";

// SCR-AUTH-02 — 비밀번호 찾기(이메일 인증). 백엔드 코드 유효 5분, 재발송 쿨다운 60초.
const CODE_TTL = 300;
const RESEND_COOLDOWN = 60;
const MAX_ATTEMPTS = 5; // 백엔드 PasswordResetService.MAX_ATTEMPTS 와 일치

const fmt = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

const sendBtnStyle = (disabled) => ({
  flexShrink: 0,
  padding: "0 16px",
  height: "46px",
  border: "none",
  borderRadius: "8px",
  background: disabled ? "#d8d7d5" : "#ff8534",
  color: "#fff",
  fontSize: "14px",
  fontWeight: 500,
  cursor: disabled ? "not-allowed" : "pointer",
  whiteSpace: "nowrap",
});

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [resendLeft, setResendLeft] = useState(0);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (secondsLeft <= 0 && resendLeft <= 0) return undefined;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
      setResendLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [secondsLeft, resendLeft]);

  const handleSend = async () => {
    setError("");
    setSending(true);
    try {
      await sendPasswordResetCode(email.trim());
      setSent(true);
      setSecondsLeft(CODE_TTL);
      setResendLeft(RESEND_COOLDOWN);
      setAttemptsLeft(MAX_ATTEMPTS); // 재발송 시 시도 횟수 초기화
      setCode("");
    } catch (err) {
      // 미가입/소셜 계정은 코드별 안내(디자인: 미가입 에러 노출 + 소셜은 소셜 로그인 유도).
      const errCode = err.response?.data?.error?.code;
      setError(
        errCode === "USER_NOT_FOUND"
          ? "가입되지 않은 이메일이에요."
          : errCode === "OAUTH_PASSWORD_UNSUPPORTED"
            ? "소셜 로그인으로 가입된 계정이에요. 소셜 로그인을 이용해주세요."
            : err.response?.data?.error?.message ||
              "인증번호 발송에 실패했어요.",
      );
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError("");
    setVerifying(true);
    try {
      await verifyPasswordResetCode(email.trim(), code.trim());
      navigate("/reset-password", { state: { email: email.trim() } });
    } catch (err) {
      const errCode = err.response?.data?.error?.code;
      if (errCode === "VERIFICATION_CODE_MISMATCH") {
        const remaining = Math.max(0, attemptsLeft - 1);
        setAttemptsLeft(remaining);
        if (remaining <= 0) {
          setSecondsLeft(0); // 5회 초과 → 백엔드가 코드 폐기, 재발송 필요
          setError("인증 횟수를 초과했어요. 인증번호를 재발송해주세요.");
        } else {
          setError(`인증번호가 일치하지 않아요. (남은 시도 ${remaining}회)`);
        }
      } else if (errCode === "VERIFICATION_CODE_EXPIRED") {
        setSecondsLeft(0);
        setError("인증번호가 만료됐어요. 재발송해주세요.");
      } else {
        setError(err.response?.data?.error?.message || "인증에 실패했어요.");
      }
    } finally {
      setVerifying(false);
    }
  };

  const codeValid = secondsLeft > 0;
  const canVerify = sent && codeValid && code.trim().length === 6 && !verifying;

  return (
    <div className={styles.page}>
      <AuthHeader />
      <div className={styles.content}>
        <div className={styles.wrapper}>
          <div className={styles.section}>
            <div style={{ fontWeight: "bold", fontSize: "36px" }}>
              비밀번호를 잊으셨나요?
            </div>
            <p
              style={{
                fontSize: "14px",
                color: "#4a4846",
                margin: "12px 0 0 0",
              }}
            >
              비밀번호 재설정을 위해 가입한 이메일 주소를 입력해 주세요.
            </p>
          </div>
          <form className={styles.loginBox} onSubmit={handleVerify}>
            <div style={{ marginBottom: "18px" }}>
              <p className={styles.loginValue}>이메일</p>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  className={styles.infoItem}
                  style={{ flex: 1 }}
                  placeholder="예) Drawe@Drawe.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || resendLeft > 0 || !email.trim()}
                  style={sendBtnStyle(
                    sending || resendLeft > 0 || !email.trim(),
                  )}
                >
                  {sending
                    ? "발송 중..."
                    : resendLeft > 0
                      ? `재전송 (${resendLeft}초)`
                      : sent
                        ? "재전송"
                        : "인증번호 받기"}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: "40px" }}>
              <p className={styles.loginValue}>인증번호</p>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  className={styles.infoItem}
                  placeholder="인증번호 6자리를 입력해주세요"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  disabled={!sent}
                />
                {sent && codeValid && (
                  <span
                    style={{
                      position: "absolute",
                      right: "14px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#ff8534",
                      fontSize: "14px",
                      fontWeight: 600,
                    }}
                  >
                    {fmt(secondsLeft)}
                  </span>
                )}
              </div>
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
              disabled={!canVerify}
              style={{
                backgroundColor: canVerify ? "#ff8534" : "#d8d7d5",
                cursor: canVerify ? "pointer" : "not-allowed",
              }}
            >
              {verifying ? "확인 중..." : "인증하기"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
