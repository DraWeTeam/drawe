import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "./login/api";
import styles from "./Home.module.css";

const Home = () => {
  const navigate = useNavigate();
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

  return (
    <div className={styles.wrapper}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Welcome back</p>
        <h1 className={styles.title}>
          {user?.nickname ? `${user.nickname}님,` : "안녕하세요,"}
          <br />
          오늘은 무엇을 그려볼까요?
        </h1>
        <p className={styles.lead}>
          DraWe의 AI 가이드와 함께 아이디어를 다듬고, 한 장의 그림으로
          완성해보세요.
        </p>
      </section>

      <section className={styles.cards}>
        <button
          className={styles.primaryCard}
          onClick={() => navigate("/projects")}
        >
          <div className={styles.cardIcon}>🎨</div>
          <div className={styles.cardBody}>
            <p className={styles.cardTitle}>내 프로젝트로 가기</p>
            <p className={styles.cardDesc}>
              만들어둔 프로젝트를 확인하거나 새 프로젝트를 시작해요.
            </p>
          </div>
          <div className={styles.cardArrow}>→</div>
        </button>
      </section>
    </div>
  );
};

export default Home;
