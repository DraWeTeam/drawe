import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../pages/login/api";
import styles from "./Header.module.css";

const HIDDEN_PATHS = ["/login", "/signup", "/oauth/callback"];

const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  const hidden = HIDDEN_PATHS.includes(location.pathname);

  useEffect(() => {
    if (hidden) {
      setUser(null);
      return;
    }
    const token = localStorage.getItem("accessToken");
    if (!token) {
      setUser(null);
      return;
    }

    const fetchMe = async () => {
      try {
        const res = await api.get("/user/profile");
        setUser(res.data.data);
      } catch {
        setUser(null);
      }
    };
    fetchMe();
  }, [hidden, location.pathname]);

  const handleLogout = async () => {
    try {
      const refreshToken = localStorage.getItem("refreshToken");
      if (refreshToken) {
        await api.post("/auth/logout", { refreshToken });
      }
    } catch {
      // ignore
    } finally {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      setUser(null);
      navigate("/login");
    }
  };

  return (
    <div className={styles.wrapper}>
      <Link to="/" className={styles.section}>
        <div className={styles.logoIcon}></div>
        <div className={styles.logoText}>
          <span className={styles.logoHighlight}>Dra</span>We
        </div>
      </Link>

      {!hidden && user && (
        <div className={styles.userArea}>
          <span className={styles.nickname}>{user.nickname}</span>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
};

export default Header;
