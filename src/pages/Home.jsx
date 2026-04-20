import { useEffect, useState } from "react";
import api from "./login/api";
import styles from "./Home.module.css";

const Home = () => {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const fetchMyInfo = async () => {
      try {
        const res = await api.get("/user/profile");
        setUser(res.data.data);
      } catch (e) {
        console.error(e);
      }
    };

    fetchMyInfo();
  }, []);

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      console.error("로그아웃 실패", e);
    } finally {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      window.location.href = "/login";
    }
  };

  return (
    <div className={styles.wrapper}>
      <h1>홈</h1>
      <div>
        {user && (
          <>
            <p>{user.email}</p>
            <p>{user.nickname}</p>

            <button onClick={handleLogout}>로그아웃</button>
          </>
        )}
      </div>
    </div>
  );
};

export default Home;
