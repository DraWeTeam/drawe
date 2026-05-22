import styles from "./Login.module.css";
import Google from "../../assets/google.png";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import api from "./api";
import { getOnboardingStatus } from "../onboarding/api"; // ← 추가
import AuthHeader from "./AuthHeader";
import { setUserId } from "../../analytics"; // ← 추가
import { track } from '../../analytics';
import { useEffect, useRef } from 'react';

function getDeviceType() {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobile|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function getUserIdFromToken(token) {
  try {
    // JWT는 .으로 구분된 3부분 — 가운데가 payload
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.sub;  // Spring Boot JWT 기본은 sub에 user_id
  } catch (e) {
    console.error('JWT decode failed', e);
    return undefined;
  }
}

const Login = () => {
  
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: "",
    password: "",
  });
  const [errorMessage, setErrorMessage] = useState("");

  const attemptCount = useRef(0);        // 시도 횟수
  const mountTime = useRef(Date.now());  // 페이지 진입 시각

  const handleGoogleLogin = () => {
     track('login_attempt', {
      login_method: 'google',
      device_type: getDeviceType(),
    });
    window.location.href = `${import.meta.env.VITE_API_URL}/oauth2/authorization/google`;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // 온보딩 체크 + 리다이렉트 — 추가
  const redirectAfterLogin = async () => {
    try {
      const status = await getOnboardingStatus();
      if (status.completed) {
        navigate("/projects");
      } else {
        navigate("/onboarding");
      }
    } catch (err) {
      console.error("온보딩 상태 조회 실패:", err);
      navigate("/projects"); // 에러 시 안전 진행
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    attemptCount.current += 1;
  
    track('login_attempt', {
      login_method: 'email',
      device_type: getDeviceType(),
    });

    try {
      const response = await api.post("/auth/login", {
        email: form.email,
        password: form.password,
      });

      const { accessToken, refreshToken } = response.data.data;

      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);

      setUserId(getUserIdFromToken(accessToken));

      track('login_success', {
        login_method: 'email',
        attempt_count: attemptCount.current,
        time_taken: Date.now() - mountTime.current,
      });

      // 변경: navigate("/") → redirectAfterLogin()
      await redirectAfterLogin();
    } catch (error) {
      const message =
        error.response?.data?.error?.message || "로그인에 실패했습니다.";
        track('login_failed', {
          login_method: 'email',
          attempt_number: attemptCount.current,
          error_type: error.response?.data?.error?.code || 'unknown',
        });
      setErrorMessage(message);
      console.log(error);
    }
  };

  return (
    <div className={styles.page}>
      <AuthHeader />
      <div className={styles.content}>
        <div className={styles.wrapper}>
          <div className={styles.section}>
            <div style={{ fontWeight: "bold", fontSize: "48px" }}>
              만나서 반가워요!
            </div>
            <p
              style={{ fontSize: "14px", opacity: "70%", margin: "12px 0 0 0" }}
            >
              DraWe와 함께하기 위해 로그인 또는 회원가입을 진행해주세요.
            </p>
          </div>
          <form className={styles.loginBox} onSubmit={handleLogin}>
            <div style={{ marginBottom: "18px" }}>
              <p className={styles.loginValue}>이메일</p>
              <input
                type="text"
                name="email"
                className={styles.infoItem}
                placeholder="예) Drawe@Drawe.com"
                value={form.email}
                onChange={handleChange}
              />
            </div>
            <div style={{ marginBottom: "52px" }}>
              <p className={styles.loginValue}>비밀번호</p>
              <input
                type="password"
                name="password"
                className={styles.infoItem}
                placeholder="Password"
                value={form.password}
                onChange={handleChange}
              />
            </div>

            {errorMessage && (
              <p
                style={{ color: "red", fontSize: "14px", margin: "0 0 16px 0" }}
              >
                {errorMessage}
              </p>
            )}

          <button type="submit" className={styles.loginBtn}>
            로그인
          </button>
          <div className={styles.divider}>
            <span className={styles.line}></span>
            <span className={styles.text}>or</span>
            <span className={styles.line}></span>
          </div>
          <button
            type="button"
            className={styles.googleBtn}
            onClick={handleGoogleLogin}
          >
            <img src={Google} className={styles.googleLogo}></img>
            <p style={{ fontWeight: "500" }}>Sign in with Google</p>
          </button>
          <div className={styles.signin}>
            <p style={{ margin: "0", fontWeight: "350" }}>계정이 없으신가요?</p>
            <Link 
              to="/signup" 
              style={{ margin: "0", fontWeight: "500" }}
              onClick={() => {
                track('signup_started', {
                  source: getUrlParam('utm_source') || 'organic',
                  medium: getUrlParam('utm_medium') || 'direct',
                  campaign: getUrlParam('utm_campaign'),
                  page_location: window.location.href,
                });
              }}
            >
              회원가입하기
            </Link>
          </div>
        </form>
      </div>
    </div>
    </div>
  );
};

function getUrlParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

export default Login;
