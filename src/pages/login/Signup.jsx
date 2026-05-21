import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { checkEmail, checkNickname, signup } from "./authApi";
import styles from "./Signup.module.css";
import AuthHeader from "./AuthHeader";
import { useEffect } from 'react';
import { track } from '../../analytics';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const Signup = () => {
  useEffect(() => {
    track('signup_form_viewed', {
      form_type: 'basic',  // 이메일 가입 폼이면 'basic'
      step_number: 1,
    });
  }, []);
  const navigate = useNavigate();
  const handleFieldFocus = (e) => {
    if (e.target.dataset.tracked) return;
    e.target.dataset.tracked = 'true';
    track('signup_form_interaction', {
      field_name: e.target.name,
      interaction_type: 'focus',
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
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (name === "email") setEmailCheck({ status: "idle", message: "" });
    if (name === "nickname") setNicknameCheck({ status: "idle", message: "" });
  };

  const trackValidationError = (errorType, fieldName, message) => {
  track('signup_validation_error', {
    error_type: errorType,
    field_name: fieldName,
    error_message: message,
  });
};

  const handleCheckEmail = async () => {
    if (!emailRegex.test(form.email)) {
      trackValidationError('invalid_email_format', 'email', "이메일 형식이 올바르지 않아요.");  // ← 추가
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
        trackValidationError('duplicate_email', 'email', "이미 사용 중인 이메일이에요.");
        setEmailCheck({
          status: "error",
          message: "이미 사용 중인 이메일이에요.",
        });
      }
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "확인 중 문제가 생겼어요.";
      trackValidationError('email_check_failed', 'email', message);
      setEmailCheck({ status: "error", message });
    }
  };

  const handleCheckNickname = async () => {
    const trimmed = form.nickname.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      trackValidationError('invalid_nickname_length', 'nickname', "닉네임은 2~20자여야 해요."); 
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
        trackValidationError('duplicate_nickname', 'nickname', "이미 사용 중인 닉네임이에요.");
        setNicknameCheck({
          status: "error",
          message: "이미 사용 중인 닉네임이에요.",
        });
      }
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "확인 중 문제가 생겼어요.";
      trackValidationError('nickname_check_failed', 'nickname', message);
        setNicknameCheck({ status: "error", message });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    if (!emailRegex.test(form.email)) {
      trackValidationError('invalid_email_format', 'email', "이메일 형식이 올바르지 않아요.");
      setErrorMessage("이메일 형식이 올바르지 않아요.");
      return;
    }
    if (form.password.length < 8) {
      trackValidationError('weak_password', 'password', "비밀번호는 8자 이상이어야 해요.");
      setErrorMessage("비밀번호는 8자 이상이어야 해요.");
      return;
    }
    if (form.password !== form.passwordConfirm) {
      trackValidationError('password_mismatch', 'passwordConfirm', "비밀번호가 일치하지 않아요.");
      setErrorMessage("비밀번호가 일치하지 않아요.");
      return;
    }
    const trimmedNickname = form.nickname.trim();
    if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
      trackValidationError('invalid_nickname_length', 'nickname', "닉네임은 2~20자여야 해요.");
      setErrorMessage("닉네임은 2~20자여야 해요.");
      return;
    }
    if (emailCheck.status !== "ok") {
      trackValidationError('email_check_required', 'email', "이메일 중복 확인을 진행해주세요.");
      setErrorMessage("이메일 중복 확인을 진행해주세요.");
      return;
    }
    if (nicknameCheck.status !== "ok") {
      trackValidationError('nickname_check_required', 'nickname', "닉네임 중복 확인을 진행해주세요.");
      setErrorMessage("닉네임 중복 확인을 진행해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      await signup({
        email: form.email,
        password: form.password,
        nickname: trimmedNickname,
      });
      track('signup_completed', {
      signup_method: 'email',
      user_type: 'free',
      });
      alert("회원가입이 완료되었어요. 로그인 페이지로 이동할게요.");
      navigate("/login");
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "회원가입에 실패했어요.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

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
