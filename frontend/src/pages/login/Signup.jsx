import { useState } from "react";
import { Link, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  checkEmail,
  checkNickname,
  signup,
  login,
  sendEmailCode,
  verifyEmailCode,
} from "./authApi";
import styles from "./Signup.module.css";
import AuthHeader from "./AuthHeader";
import { useEffect } from "react";
import { track } from "../../analytics";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const Signup = () => {
  useEffect(() => {
    track("signup_form_viewed", {
      form_type: "basic", // 이메일 가입 폼이면 'basic'
      step_number: 1,
    });
  }, []);
  const navigate = useNavigate();
  const location = useLocation();
  // 약관 동의 화면(/signup/terms)에서 전달받은 동의 내역
  const agreements = location.state?.agreements;
  const handleFieldFocus = (e) => {
    if (e.target.dataset.tracked) return;
    e.target.dataset.tracked = "true";
    track("signup_form_interaction", {
      field_name: e.target.name,
      interaction_type: "focus",
    });
  };
  const [form, setForm] = useState({
    email: "",
    password: "",
    passwordConfirm: "",
    nickname: "",
  });
  const [emailCheck, setEmailCheck] = useState({ status: "idle", message: "" });
  const [nicknameCheck, setNicknameCheck] = useState({
    status: "idle",
    message: "",
  });
  // 이메일 인증 (TODO: 인증 UI 확정되면 디자인 교체)
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [emailVerify, setEmailVerify] = useState({
    status: "idle",
    message: "",
  });
  // 인증번호 유효시간(5분=300s) / 재발송 쿨다운(60s) — 백엔드 TTL과 동일
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [resendLeft, setResendLeft] = useState(0);
  // 인증번호 입력 가능 횟수 (백엔드 MAX_ATTEMPTS=5)
  const MAX_ATTEMPTS = 5;
  const [attemptsLeft, setAttemptsLeft] = useState(0);
  const [sendingCode, setSendingCode] = useState(false); // 발송 요청 진행 중

  // 1초마다 두 타이머 감소
  const timerActive = secondsLeft > 0 || resendLeft > 0;
  useEffect(() => {
    if (!timerActive) return undefined;
    const id = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
      setResendLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [timerActive]);

  // 유효시간 만료 처리: 코드가 실제로 발송된(=sent) 뒤 카운트다운이 0이 됐을 때만
  useEffect(() => {
    if (emailVerify.status === "sent" && secondsLeft === 0) {
      setEmailVerify({
        status: "error",
        message: "인증번호가 만료됐어요. 재발송해주세요.",
      });
    }
  }, [secondsLeft, emailVerify.status]);
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (name === "email") {
      setEmailCheck({ status: "idle", message: "" });
      // 이메일이 바뀌면 인증 상태/타이머 초기화
      setCodeSent(false);
      setCode("");
      setEmailVerify({ status: "idle", message: "" });
      setSecondsLeft(0);
      setResendLeft(0);
      setAttemptsLeft(0);
    }
    if (name === "nickname") setNicknameCheck({ status: "idle", message: "" });
  };

  const handleSendCode = async () => {
    if (!emailRegex.test(form.email)) {
      setEmailVerify({
        status: "error",
        message: "이메일 형식이 올바르지 않아요.",
      });
      return;
    }
    // 낙관적 표시: 클릭 즉시 입력 칸을 띄우고, 발송 결과는 아래에서 처리
    setSendingCode(true);
    setCodeSent(true);
    setCode("");
    setSecondsLeft(0); // 발송 성공 전까지는 타이머 미시작 (입력 비활성)
    setResendLeft(0);
    setEmailVerify({
      status: "sending",
      message: "인증번호를 보내는 중이에요...",
    });
    try {
      await sendEmailCode(form.email);
      setSecondsLeft(300); // 코드 유효시간 5분
      setResendLeft(60); // 재발송 쿨다운 60초
      setAttemptsLeft(MAX_ATTEMPTS); // 시도 횟수 초기화
      setEmailVerify({
        status: "sent",
        message: "인증번호를 메일로 보냈어요.",
      });
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "인증번호 발송에 실패했어요.";
      // 발송 실패 → 코드 없음. 입력 칸은 비활성 상태로 두고 재발송 유도
      setEmailVerify({ status: "error", message });
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      setEmailVerify({ status: "error", message: "인증번호를 입력해주세요." });
      return;
    }
    try {
      await verifyEmailCode(form.email, code.trim());
      setEmailVerify({ status: "ok", message: "이메일 인증이 완료됐어요." });
      setSecondsLeft(0); // 인증 완료 → 유효시간 카운트다운 종료
    } catch (err) {
      const errorCode = err.response?.data?.error?.code;
      // 인증번호 불일치만 시도 횟수 차감 (만료/기타는 제외)
      if (errorCode === "VERIFICATION_CODE_MISMATCH") {
        const remaining = Math.max(0, attemptsLeft - 1);
        setAttemptsLeft(remaining);
        if (remaining <= 0) {
          setSecondsLeft(0); // 5회 초과 → 코드 폐기됨, 재발송 필요
          setEmailVerify({
            status: "error",
            message: "인증 횟수를 초과했어요. 인증번호를 재발송해주세요.",
          });
        } else {
          setEmailVerify({
            status: "error",
            message: `인증번호가 일치하지 않아요. (남은 시도 ${remaining}회)`,
          });
        }
        return;
      }
      const message =
        err.response?.data?.error?.message || "인증번호 확인에 실패했어요.";
      setEmailVerify({ status: "error", message });
    }
  };

  const trackValidationError = (errorType, fieldName, message) => {
    track("signup_validation_error", {
      error_type: errorType,
      field_name: fieldName,
      error_message: message,
    });
  };

  const handleCheckEmail = async () => {
    if (!emailRegex.test(form.email)) {
      trackValidationError(
        "invalid_email_format",
        "email",
        "이메일 형식이 올바르지 않아요.",
      ); // ← 추가
      setEmailCheck({
        status: "error",
        message: "이메일 형식이 올바르지 않아요.",
      });
      return;
    }
    try {
      const data = await checkEmail(form.email);
      if (data?.available) {
        setEmailCheck({ status: "ok", message: "사용 가능한 이메일이에요." });
      } else {
        trackValidationError(
          "duplicate_email",
          "email",
          "이미 사용 중인 이메일이에요.",
        );
        setEmailCheck({
          status: "error",
          message: "이미 사용 중인 이메일이에요.",
        });
      }
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "확인 중 문제가 생겼어요.";
      trackValidationError("email_check_failed", "email", message);
      setEmailCheck({ status: "error", message });
    }
  };

  const handleCheckNickname = async () => {
    const trimmed = form.nickname.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      trackValidationError(
        "invalid_nickname_length",
        "nickname",
        "닉네임은 2~20자여야 해요.",
      );
      setNicknameCheck({
        status: "error",
        message: "닉네임은 2~20자여야 해요.",
      });
      return;
    }
    try {
      const data = await checkNickname(trimmed);
      if (data?.available) {
        setNicknameCheck({
          status: "ok",
          message: "사용 가능한 닉네임이에요.",
        });
      } else {
        trackValidationError(
          "duplicate_nickname",
          "nickname",
          "이미 사용 중인 닉네임이에요.",
        );
        setNicknameCheck({
          status: "error",
          message: "이미 사용 중인 닉네임이에요.",
        });
      }
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "확인 중 문제가 생겼어요.";
      trackValidationError("nickname_check_failed", "nickname", message);
      setNicknameCheck({ status: "error", message });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    if (!emailRegex.test(form.email)) {
      trackValidationError(
        "invalid_email_format",
        "email",
        "이메일 형식이 올바르지 않아요.",
      );
      setErrorMessage("이메일 형식이 올바르지 않아요.");
      return;
    }
    if (form.password.length < 8) {
      trackValidationError(
        "weak_password",
        "password",
        "비밀번호는 8자 이상이어야 해요.",
      );
      setErrorMessage("비밀번호는 8자 이상이어야 해요.");
      return;
    }
    if (form.password !== form.passwordConfirm) {
      trackValidationError(
        "password_mismatch",
        "passwordConfirm",
        "비밀번호가 일치하지 않아요.",
      );
      setErrorMessage("비밀번호가 일치하지 않아요.");
      return;
    }
    const trimmedNickname = form.nickname.trim();
    if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
      trackValidationError(
        "invalid_nickname_length",
        "nickname",
        "닉네임은 2~20자여야 해요.",
      );
      setErrorMessage("닉네임은 2~20자여야 해요.");
      return;
    }
    if (emailCheck.status !== "ok") {
      trackValidationError(
        "email_check_required",
        "email",
        "이메일 중복 확인을 진행해주세요.",
      );
      setErrorMessage("이메일 중복 확인을 진행해주세요.");
      return;
    }
    if (nicknameCheck.status !== "ok") {
      trackValidationError(
        "nickname_check_required",
        "nickname",
        "닉네임 중복 확인을 진행해주세요.",
      );
      setErrorMessage("닉네임 중복 확인을 진행해주세요.");
      return;
    }
    if (emailVerify.status !== "ok") {
      trackValidationError(
        "email_verification_required",
        "email",
        "이메일 인증을 완료해주세요.",
      );
      setErrorMessage("이메일 인증을 완료해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      await signup({
        email: form.email,
        password: form.password,
        nickname: trimmedNickname,
        agreeTerms: !!agreements.agreeTerms,
        agreePrivacy: !!agreements.agreePrivacy,
        agreeAge: !!agreements.agreeAge,
      });

      // 자동 로그인
      const loginRes = await login({
        email: form.email,
        password: form.password,
      });
      localStorage.setItem("accessToken", loginRes.accessToken);
      if (loginRes.refreshToken) {
        localStorage.setItem("refreshToken", loginRes.refreshToken);
      }

      track("signup_completed", {
        signup_method: "email",
        user_type: "free",
      });

      navigate("/signup/complete"); // 완료 화면으로
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "회원가입에 실패했어요.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  // 약관 동의를 거치지 않고 직접 진입한 경우 약관 화면으로 돌려보냄
  if (!agreements) {
    return <Navigate to="/signup/terms" replace />;
  }

  return (
    <div className={styles.page}>
      <AuthHeader />
      <div className={styles.content}>
        <div className={styles.wrapper}>
          <div className={styles.section}>
            <div className={styles.heroTitle}>회원가입</div>
            <p className={styles.heroSub}>
              DraWe와 함께 그림 여정을 시작해보세요.
            </p>
          </div>
          <form className={styles.signupBox} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <p className={styles.label}>이메일</p>
              <div className={styles.row}>
                <input
                  type="text"
                  name="email"
                  className={styles.input}
                  placeholder="예) Drawe@Drawe.com"
                  value={form.email}
                  onChange={handleChange}
                />
                <button
                  type="button"
                  className={styles.checkBtn}
                  onClick={handleCheckEmail}
                >
                  중복 확인
                </button>
              </div>
              {emailCheck.message && (
                <p
                  className={
                    emailCheck.status === "ok"
                      ? styles.helperOk
                      : styles.helperError
                  }
                >
                  {emailCheck.message}
                </p>
              )}

              {/* 이메일 인증 (임시 UI — 확정 디자인 나오면 교체) */}
              {(() => {
                const verified = emailVerify.status === "ok";
                // 코드가 발송됐지만 유효시간이 끝났거나 시도 횟수를 모두 소진 → 재발송 필요
                const codeDead = codeSent && !verified && secondsLeft === 0;
                const fmt = (s) =>
                  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
                return (
                  <>
                    <button
                      type="button"
                      className={styles.verifySendBtn}
                      onClick={handleSendCode}
                      disabled={verified || resendLeft > 0 || sendingCode}
                    >
                      {sendingCode
                        ? "발송 중..."
                        : !codeSent
                          ? "인증번호 받기"
                          : resendLeft > 0
                            ? `재발송 (${resendLeft}초 후 가능)`
                            : "인증번호 재발송"}
                    </button>
                    {codeSent && (
                      <div className={styles.row} style={{ marginTop: 8 }}>
                        <div className={styles.codeInputWrap}>
                          <input
                            type="text"
                            name="code"
                            inputMode="numeric"
                            className={styles.input}
                            placeholder="인증번호 6자리"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            disabled={verified || codeDead}
                            maxLength={6}
                          />
                          {!verified && secondsLeft > 0 && (
                            <span className={styles.codeTimer}>
                              {fmt(secondsLeft)}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className={styles.checkBtn}
                          onClick={handleVerifyCode}
                          disabled={verified || codeDead}
                        >
                          인증 확인
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
              {emailVerify.message && (
                <p
                  className={
                    emailVerify.status === "error"
                      ? styles.helperError
                      : styles.helperOk
                  }
                >
                  {emailVerify.message}
                </p>
              )}
            </div>

            <div className={styles.field}>
              <p className={styles.label}>닉네임</p>
              <div className={styles.row}>
                <input
                  type="text"
                  name="nickname"
                  className={styles.input}
                  placeholder="2~20자"
                  value={form.nickname}
                  onChange={handleChange}
                  onFocus={handleFieldFocus}
                  maxLength={20}
                />
                <button
                  type="button"
                  className={styles.checkBtn}
                  onClick={handleCheckNickname}
                >
                  중복 확인
                </button>
              </div>
              {nicknameCheck.message && (
                <p
                  className={
                    nicknameCheck.status === "ok"
                      ? styles.helperOk
                      : styles.helperError
                  }
                >
                  {nicknameCheck.message}
                </p>
              )}
            </div>

            <div className={styles.field}>
              <p className={styles.label}>비밀번호</p>
              <input
                type="password"
                name="password"
                className={styles.input}
                placeholder="8자 이상"
                value={form.password}
                onChange={handleChange}
                onFocus={handleFieldFocus}
              />
            </div>

            <div className={styles.fieldLast}>
              <p className={styles.label}>비밀번호 확인</p>
              <input
                type="password"
                name="passwordConfirm"
                className={styles.input}
                placeholder="비밀번호 다시 입력"
                value={form.passwordConfirm}
                onChange={handleChange}
                onFocus={handleFieldFocus}
              />
            </div>

            {errorMessage && <p className={styles.error}>{errorMessage}</p>}

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={submitting}
            >
              {submitting ? "가입 중..." : "가입하기"}
            </button>

            <div className={styles.bottomNote}>
              <p style={{ margin: 0, fontWeight: 350 }}>
                이미 계정이 있으신가요?
              </p>
              <Link
                to="/login"
                style={{ margin: 0, fontWeight: 500, color: "#ff8534" }}
              >
                로그인하기
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Signup;
