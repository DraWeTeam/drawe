import { useNavigate } from "react-router-dom";
import styles from "./AuthHeader.module.css";

const AuthHeader = ({ onBack }) => {
  const navigate = useNavigate();
  const handleBack = onBack ?? (() => navigate(-1));

  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={handleBack}
        aria-label="뒤로 가기"
      >
        <BackIcon />
      </button>
    </header>
  );
};

const BackIcon = () => (
  <svg
    width="12"
    height="20"
    viewBox="0 0 12 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10 20L0 10L10 0L11.775 1.775L3.55 10L11.775 18.225L10 20Z"
      fill="#4A4846"
    />
  </svg>
);

export default AuthHeader;
