import { useEffect, useMemo, useRef, useState } from "react";
import api from "../login/api";
import Tooltip from "../../components/Tooltip";
import styles from "./ReferenceGrid.module.css";
import { track } from "../../analytics";
import { unsplashSized } from "./imageUtils";

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
  onArchive,
  archivedIds,
  expanded,
  firstMenuRef,
}) => {
  const hasReferences = references && references.length > 0;
  const totalCount = (references || []).length;
  const columnCount = expanded ? 3 : 2;

  const displayItems = useMemo(() => {
    const refs = references || [];
    const pins = pinnedRefs || [];

    // 1. 모든 핀들 — 고정 슬롯 번호(1~N). 핀 순서 기준이라 검색 갱신/핀 추가에도 안 흔들린다.
    const pinnedItems = pins.map((p, i) => ({
      ref: p,
      index: null,
      pinSlot: i + 1,
    }));

    // 2. 검색 번호는 references 내 "원래 위치"(1~N)로 먼저 고정한 뒤 핀된 것만 빼낸다.
    //    번호를 다시 매기지 않으므로 핀해도 남은 번호가 안 흔들린다(예: 2번 핀 → 1,3 그대로, 2 자리만 비움).
    //    핀된 이미지는 위 pinnedItems에서 "고정 N"으로 따로 표시되므로 번호 자리에 공백이 생기는 건 정상.
    const refItems = refs
      .map((ref, i) => ({ ref, index: i + 1, pinSlot: null }))
      .filter((item) => !pins.some((p) => p.id === item.ref.id));

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
          <EmptyBoardIcon />
          <p className={styles.emptyTitle}>레퍼런스 보드가 비어있어요</p>
          <p className={styles.emptyHint}>
            원하는 레퍼런스에 대해 질문해보세요
          </p>
          <p className={styles.scopeText}>(풍경 · 인물 · 동물 · 정물 위주)</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {columns.map((column, colIdx) => (
            <div key={colIdx} className={styles.column}>
              {column.map(({ ref, index, pinSlot }) => (
                <ReferenceCard
                  key={ref.id}
                  reference={ref}
                  index={index}
                  pinSlot={pinSlot}
                  isPinned={pinnedIds?.has(ref.id) ?? false}
                  isArchived={archivedIds?.has(ref.id) ?? false}
                  onPinToggle={onPinToggle}
                  onArchive={onArchive}
                  onClick={() => onCardClick(ref, index)}
                  menuBtnRef={
                    ref.id === displayItems[0]?.ref.id
                      ? firstMenuRef
                      : undefined
                  }
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
  pinSlot,
  isPinned,
  isArchived,
  onPinToggle,
  onArchive,
  onClick,
  menuBtnRef,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState(null); // 'LIKE' | 'DISLIKE' | null
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const menuRef = useRef(null);

  const handleArchiveClick = async (e) => {
    e.stopPropagation();
    if (archiving) return;
    setMenuOpen(false);
    setArchiving(true);
    try {
      await onArchive?.(reference.id);
    } finally {
      setArchiving(false);
    }
  };

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

    const previous = feedback;
    const lastFeedbackTime = parseInt(
      localStorage.getItem(`feedback_time_${reference.id}`) || "0",
    );

    try {
      let actionType;
      let feedbackType;

      if (feedback === type) {
        await api.delete(`/images/${reference.id}/feedback`);
        setFeedback(null);
        actionType = "removed";
        feedbackType = "none";
      } else {
        await api.post(`/images/${reference.id}/feedback`, { type });
        setFeedback(type);
        actionType = previous === null ? "applied" : "changed";
        feedbackType = type.toLowerCase();
      }

      const props = {
        reference_id: reference.id,
        action_type: actionType,
        feedback_type: feedbackType,
        previous_feedback_type: previous ? previous.toLowerCase() : "none",
        reference_position: index || 0,
        // iteration_count, input_mode는 카드 컴포넌트에선 모름 → 부모에서 prop으로 받거나 0
        iteration_count: 0,
        input_mode: "text",
        reference_tags: reference?.tags?.join(",") || "",
      };

      if (actionType === "changed" || actionType === "removed") {
        props.time_since_previous_sec = lastFeedbackTime
          ? Math.floor((Date.now() - lastFeedbackTime) / 1000)
          : 0;
      }

      track("prompt_reference_feedback", props);
      localStorage.setItem(
        `feedback_time_${reference.id}`,
        Date.now().toString(),
      );
    } catch (err) {
      console.error("피드백 실패", err);
    }
  };

  const label =
    reference.photographerName ||
    (pinSlot != null
      ? `고정 이미지 ${pinSlot}`
      : index !== null
        ? `이미지 ${index}`
        : "핀된 이미지");

  return (
    <div
      className={`${styles.card} ${menuOpen ? styles.cardActive : ""}`}
      onClick={onClick}
    >
      <div className={styles.cardImage}>
        {imgFailed ? (
          <div className={styles.imageFallback} aria-hidden>
            <BrokenImageIcon />
          </div>
        ) : (
          <img
            src={unsplashSized(reference.url, 400)}
            alt={
              pinSlot != null
                ? `고정 이미지 ${pinSlot}`
                : index !== null
                  ? `참고 이미지 ${index}`
                  : reference.photographerName || "핀된 참고 이미지"
            }
            className={styles.image}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        )}
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
          {pinSlot != null ? (
            <span className={`${styles.indexBadge} ${styles.pinBadge}`}>
              고정 {pinSlot}
            </span>
          ) : (
            index !== null && <span className={styles.indexBadge}>{index}</span>
          )}
          <span className={styles.labelText}>{label}</span>
        </span>
        <div
          className={styles.menuWrap}
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip label="옵션 보기" placement="bottom">
            <button
              type="button"
              className={styles.menuBtn}
              onClick={handleMenuClick}
              aria-label="옵션 보기"
              ref={menuBtnRef}
            >
              <DotsIcon />
            </button>
          </Tooltip>
          {menuOpen && (
            <div className={styles.menuPopup}>
              <button
                type="button"
                className={styles.menuItem}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onPinToggle(reference.id);
                }}
              >
                {isPinned ? (
                  <PinOutlineIcon size={14} />
                ) : (
                  <PinIcon size={14} />
                )}
                <span>{isPinned ? "고정 취소하기" : "고정하기"}</span>
              </button>
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
                className={`${styles.menuItem} ${
                  isArchived ? styles.menuItemActive : ""
                }`}
                onClick={handleArchiveClick}
                disabled={archiving || isArchived}
              >
                <ArchiveIcon />
                <span>{isArchived ? "아카이브됨" : "아카이브"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ===== 아이콘 ===== */
// 이미지 로드 실패 시 카드 안에 표시(브라우저 기본 깨진 아이콘 대신)
const BrokenImageIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#c2bcb4"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 15l4-4 4 4M13 13l2-2 6 6" />
    <circle cx="8.5" cy="8.5" r="1.4" />
  </svg>
);

const EmptyBoardIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5.33333 48C3.86667 48 2.61111 47.4778 1.56667 46.4333C0.522222 45.3889 0 44.1333 0 42.6667V5.33333C0 3.86667 0.522222 2.61111 1.56667 1.56667C2.61111 0.522222 3.86667 0 5.33333 0H42.6667C44.1333 0 45.3889 0.522222 46.4333 1.56667C47.4778 2.61111 48 3.86667 48 5.33333V42.6667C48 44.1333 47.4778 45.3889 46.4333 46.4333C45.3889 47.4778 44.1333 48 42.6667 48H5.33333ZM5.33333 42.6667H42.6667V5.33333H5.33333V42.6667ZM8 37.3333H40L30 24L22 34.6667L16 26.6667L8 37.3333ZM17.5 17.5C18.2778 16.7222 18.6667 15.7778 18.6667 14.6667C18.6667 13.5556 18.2778 12.6111 17.5 11.8333C16.7222 11.0556 15.7778 10.6667 14.6667 10.6667C13.5556 10.6667 12.6111 11.0556 11.8333 11.8333C11.0556 12.6111 10.6667 13.5556 10.6667 14.6667C10.6667 15.7778 11.0556 16.7222 11.8333 17.5C12.6111 18.2778 13.5556 18.6667 14.6667 18.6667C15.7778 18.6667 16.7222 18.2778 17.5 17.5Z"
      fill="#D8D7D5"
    />
  </svg>
);

const PinIcon = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
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

const PinOutlineIcon = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10.6066 12.728V15.5564L9.19239 16.9706L5.65686 13.4351L1.41422 17.6777H3.21865e-06V16.2635L4.24264 12.0209L0.70711 8.48536L2.12132 7.07114H4.94975L9.8995 2.1214L9.19239 1.41429L10.6066 7.55191e-05L17.6777 7.07114L16.2635 8.48536L15.5564 7.77825L10.6066 12.728Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="19" r="1.5" />
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
