import AuthedImage from "./AuthedImage";
import { axisLabel } from "./guideLabels";
import styles from "./GuideCollectionPanel.module.css";

// 가이드 모아보기(SCR-GUIDE-02-2) — 우측 채팅 위 오버레이 패널.
//   getGuides 결과(=채팅에 복원된 guide 메시지)를 가로 리스트카드로 정리한다. 순수 조회.
//   ★대그룹 태그(첫 brand 칩)는 4대그룹 매핑이 아직 없어 미도입 — 소그룹(축) 태그만 표시.
const GuideCollectionPanel = ({ guides, onClose, onCardClick }) => {
  return (
    <div className={styles.overlay} role="dialog" aria-label="가이드 모아보기">
      <div className={styles.header}>
        <h2 className={styles.title}>한 끗 가이드</h2>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="닫기"
        >
          <CloseIcon />
        </button>
      </div>

      <div className={styles.list}>
        {guides.map((g, i) => {
          const title =
            axisLabel(g.guide?.primary_focus) || g.guideTitle || "한 끗";
          const axes = (g.guide?.blocks || [])
            .map((b) => b.sub_problem)
            .filter(Boolean)
            .slice(0, 3);
          return (
            <button
              key={g._gid ?? i}
              type="button"
              className={styles.card}
              onClick={() => onCardClick(g)}
            >
              <span className={styles.thumb}>
                {g.guidePreview ? (
                  <AuthedImage
                    className={styles.thumbImg}
                    src={g.guidePreview}
                    alt=""
                  />
                ) : (
                  <ImgPlaceholderIcon />
                )}
              </span>
              <span className={styles.info}>
                <span className={styles.cardTitle}>{title}</span>
                {axes.length > 0 && (
                  <span className={styles.tags}>
                    {axes.map((ax, j) => (
                      <span key={j} className={styles.tag}>
                        {axisLabel(ax)}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const CloseIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const ImgPlaceholderIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M4 18l5-5 4 4 3-3 4 4" />
  </svg>
);

export default GuideCollectionPanel;
