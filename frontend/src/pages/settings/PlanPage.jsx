import { useEffect, useState } from "react";
import { getProfile } from "./api";
import { PLANS } from "./plans";
import styles from "./PlanPage.module.css";

const PlanPage = () => {
  const [currentPlan, setCurrentPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const profile = await getProfile();
        if (alive) setCurrentPlan(profile?.plan ?? "free");
      } catch (err) {
        if (alive)
          setErrorMessage(
            err.response?.data?.error?.message ||
              "요금제 정보를 불러오지 못했어요.",
          );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>요금제</h1>
        <span className={styles.subtitle}>내게 맞는 플랜을 선택하세요.</span>
      </header>

      {loading ? (
        <div className={styles.stateBox}>불러오는 중…</div>
      ) : errorMessage ? (
        <div className={styles.stateBox}>{errorMessage}</div>
      ) : (
        <div className={styles.planGrid}>
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.code}
              plan={plan}
              current={plan.code === currentPlan}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ── 플랜 카드 ───────────────────────────────────── */
const PlanCard = ({ plan, current }) => {
  return (
    <div
      className={`${styles.planCard} ${plan.highlight ? styles.highlight : ""} ${
        current ? styles.currentCard : ""
      }`}
    >
      <div className={styles.planHead}>
        <span className={styles.planName}>{plan.name}</span>
        {current && <span className={styles.currentBadge}>현재 플랜</span>}
      </div>

      <div className={styles.planPrice}>
        {plan.price}
        <span className={styles.planPeriod}>/ {plan.period}</span>
      </div>

      <ul className={styles.featureList}>
        {plan.features.map((f) => (
          <li key={f} className={styles.feature}>
            {f}
          </li>
        ))}
      </ul>

      {current ? (
        <button type="button" className={styles.currentBtn} disabled>
          사용 중
        </button>
      ) : plan.code === "free" ? null : (
        <button
          type="button"
          className={styles.upgradeBtn}
          disabled
          title="준비 중"
        >
          업그레이드 (준비 중)
        </button>
      )}
    </div>
  );
};

export default PlanPage;
