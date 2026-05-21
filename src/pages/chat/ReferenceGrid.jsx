import { useEffect, useMemo, useRef, useState } from "react";
import api from "../login/api";
import styles from "./ReferenceGrid.module.css";

const ReferenceGrid = ({
  references,
  loading,
  justUpdated,
  pinnedRefs,
  pinnedIds,
  pinError,
  onClearPinError,
  onPinToggle,
  onCardClick,
  expanded,
}) => {
  const hasReferences = references && references.length > 0;
  const totalCount = (references || []).length;
  const columnCount = expanded ? 4 : 2;

  const displayItems = useMemo(() => {
    const refs = references || [];
    const pins = pinnedRefs || [];

    // 1. 모든 핀들 — 번호 X
    const pinnedItems = pins.map((p) => ({ ref: p, index: null }));

    // 2. references 중 핀과 id 같은 건 배제 — 나머지에 번호 1~N
    const refItems = refs
      .filter((ref) => !pins.some((p) => p.id === ref.id))
      .map((ref, i) => ({ ref, index: i + 1 }));

    return [...pinnedItems, ...refItems];
  }, [references, pinnedRefs]);

  const columns = splitIntoColumns(displayItems, columnCount);

  return (
    <div className={styles.wrapper}>
      {/* 필터 탭 */}
      <div className={styles.filterTabs}>
        <button
          type="button"
          className={`${styles.filterTab} ${styles.filterTabActive}`}
        >
          전체
        </button>
        <button
          type="button"
          className={styles.filterTab}
          disabled
          title="준비 중"
        >
          AI
        </button>
        <button
          type="button"
          className={styles.filterTab}
          disabled
          title="준비 중"
        >
          아카이브
        </button>

        {hasReferences && <span className={styles.count}>{totalCount}개</span>}
      </div>

      {/* 핀 에러 배너 */}
      {pinError && (
        <div className={styles.pinErrorBanner}>
          <span>⚠️ {pinError}</span>
          <button
            type="button"
            onClick={onClearPinError}
            aria-label="닫기"
            className={styles.pinErrorClose}
          >
            ×
          </button>
        </div>
      )}

      {/* 업데이트 뱃지 */}
      {justUpdated && hasReferences && (
        <div className={styles.updateBadge}>🆕 새로 추가됨</div>
      )}

      {/* 콘텐츠 */}
      {loading && !hasReferences ? (
        <div className={styles.loading}>이미지 검색 중...</div>
      ) : !hasReferences ? (
        <div className={styles.empty}>
          <p>그림에 대해 질문해보세요.</p>
          <p className={styles.emptyHint}>
            관련 참고 이미지를 자동으로 찾아드려요.
          </p>
          <p className={styles.scopeText}>(풍경 · 인물 · 동물 · 정물 위주)</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {columns.map((column, colIdx) => (
            <div key={colIdx} className={styles.column}>
              {column.map(({ ref, index }) => (
                <ReferenceCard
                  key={ref.id}
                  reference={ref}
                  index={index}
                  isPinned={pinnedIds?.has(ref.id) ?? false}
                  onPinToggle={onPinToggle}
                  onClick={() => onCardClick(ref)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function splitIntoColumns(items, columnCount) {
  const columns = Array.from({ length: columnCount }, () => []);
  items.forEach((item, idx) => {
    const colIdx = idx % columnCount;
    columns[colIdx].push(item); // item = { ref, index } 그대로
  });
  return columns;
}

const ReferenceCard = ({
  reference,
  index,
  isPinned,
  onPinToggle,
  onClick,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState(null); // 'LIKE' | 'DISLIKE' | null
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const controller = new AbortController();

    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      controller.abort();
    };
  }, [menuOpen]);

  const handlePinClick = (e) => {
    e.stopPropagation();
    onPinToggle(reference.id);
  };

  const handleMenuClick = async (e) => {
    e.stopPropagation();
    // 메뉴 처음 열 때 피드백 상태 조회
    if (!menuOpen && !feedbackLoaded) {
      try {
        const res = await api.get(`/images/${reference.id}/feedback`);
        setFeedback(res.data.data?.type ?? null);
      } catch (err) {
        console.error("피드백 조회 실패", err);
      } finally {
        setFeedbackLoaded(true);
      }
    }
    setMenuOpen((o) => !o);
  };

  const handleFeedback = async (e, type) => {
    e.stopPropagation();
    setMenuOpen(false);
    try {
      if (feedback === type) {
        // 같은 피드백 다시 누르면 취소
        await api.delete(`/images/${reference.id}/feedback`);
        setFeedback(null);
      } else {
        await api.post(`/images/${reference.id}/feedback`, { type });
        setFeedback(type);
      }
    } catch (err) {
      console.error("피드백 실패", err);
    }
  };

  const label =
    reference.photographerName ||
    (index !== null ? `이미지 ${index}` : "핀된 이미지");

  return (
    <div
      className={`${styles.card} ${menuOpen ? styles.cardActive : ""}`}
      onClick={onClick}
    >
      <div className={styles.cardImage}>
        <img
          src={reference.url}
          alt={
            index !== null
              ? `참고 이미지 ${index}`
              : reference.photographerName || "핀된 참고 이미지"
          }
          className={styles.image}
          loading="lazy"
        />
        <button
          type="button"
          className={`${styles.pinBtn} ${isPinned ? styles.pinBtnActive : ""}`}
          onClick={handlePinClick}
          aria-label={isPinned ? "핀 해제" : "핀하기"}
          title={isPinned ? "핀 해제" : "핀하기"}
        >
          <PinIcon />
        </button>
      </div>

      <div className={styles.cardFooter}>
        <span className={styles.cardLabel}>
          {index !== null && <span className={styles.indexBadge}>{index}</span>}
          <span className={styles.labelText}>{label}</span>
        </span>
        <div
          className={styles.menuWrap}
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={styles.menuBtn}
            onClick={handleMenuClick}
            aria-label="더보기"
          >
            <DotsIcon />
          </button>
          {menuOpen && (
            <div className={styles.menuPopup}>
              <button
                type="button"
                className={`${styles.menuItem} ${
                  feedback === "LIKE" ? styles.menuItemActive : ""
                }`}
                onClick={(e) => handleFeedback(e, "LIKE")}
              >
                <ThumbsUpIcon />
                <span>마음에 들어요</span>
              </button>
              <button
                type="button"
                className={`${styles.menuItem} ${
                  feedback === "DISLIKE" ? styles.menuItemActive : ""
                }`}
                onClick={(e) => handleFeedback(e, "DISLIKE")}
              >
                <ThumbsDownIcon />
                <span>별로예요</span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                disabled
                title="준비 중"
              >
                <ArchiveIcon />
                <span>아카이브</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ===== 아이콘 ===== */
const PinIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10.6066 12.728V15.5564L9.19239 16.9706L5.65686 13.4351L1.41422 17.6777H3.21865e-06V16.2635L4.24264 12.0209L0.70711 8.48536L2.12132 7.07114H4.94975L9.8995 2.1214L9.19239 1.41429L10.6066 7.55191e-05L17.6777 7.07114L16.2635 8.48536L15.5564 7.77825L10.6066 12.728Z"
      fill="currentColor"
    />
  </svg>
);

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </svg>
);

const ThumbsUpIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 11v8a2 2 0 0 0 2 2h7.5a2 2 0 0 0 2-1.5l1.5-6.5a2 2 0 0 0-2-2.5h-4l.7-3.5a2 2 0 0 0-2-2.5L10 8 7 11z" />
  </svg>
);

const ThumbsDownIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 13V5a2 2 0 0 0-2-2H7.5a2 2 0 0 0-2 1.5L4 11a2 2 0 0 0 2 2.5h4l-.7 3.5a2 2 0 0 0 2 2.5L14 16l3-3z" />
  </svg>
);

const ArchiveIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

export default ReferenceGrid;
