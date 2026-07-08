import styles from "./FeedbackCard.module.css";

// 우측 화살표(→) — 시안의 detail 아이콘 대체 글리프
const ArrowRightIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

/**
 * 채팅 흐름 하단에 렌더되는 인라인 "피드백 제공하기" 카드 (SCR-GUIDE-02).
 * 클릭하면 FeedbackModal 이 열린다.
 */
export default function FeedbackCard({ onClick }) {
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <span className={styles.text}>
        <span className={styles.title}>피드백 제공하기</span>
        <span className={styles.subtitle}>
          더 나은 서비스를 제공하기 위해 솔직한 후기를 남겨주세요!
        </span>
      </span>
      <span className={styles.arrow}>
        <ArrowRightIcon />
      </span>
    </button>
  );
}
