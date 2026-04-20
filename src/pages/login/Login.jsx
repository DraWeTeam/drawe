import styles from "./Login.module.css";
import Google from "../../assets/google.png";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import api from "./api";

const Login = () => {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: "",
    password: "",
  });
  const [errorMessage, setErrorMessage] = useState("");

  const handleGoogleLogin = () => {
    window.location.href = "http://localhost:8080/oauth2/authorization/google";
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    try {
      const response = await api.post("/auth/login", {
        email: form.email,
        password: form.password,
      });

      console.log("response.data:", response.data);
      console.log("response.data.data:", response.data.data);

      const { accessToken, refreshToken } = response.data.data;

      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);

      navigate("/");
    } catch (error) {
      const message =
        error.response?.data?.error?.message || "로그인에 실패했습니다.";
      setErrorMessage(message);
      console.log(error);
    }
  };

  return (
    <>
      <div className={styles.wrapper}>
        <div className={styles.section}>
          <div style={{ fontWeight: "bold", fontSize: "48px" }}>
            만나서 반가워요!
          </div>
          <p style={{ fontSize: "14px", opacity: "70%", margin: "12px 0 0 0" }}>
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
            <p style={{ color: "red", fontSize: "14px", margin: "0 0 16px 0" }}>
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
            <Link style={{ margin: "0", fontWeight: "500" }}>회원가입하기</Link>
          </div>
        </form>
      </div>
    </>
  );
};

export default Login;
