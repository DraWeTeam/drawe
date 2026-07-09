import { useEffect, useRef, useState } from "react";
import AuthedImage from "../chat/AuthedImage";
import styles from "./ArchivePage.module.css";

// SCR-ARCH-02 컬렉션 카드 — 모자이크 썸네일 + 컬렉션명 + 태그칩.
//   thumbnails 는 앞 최대 4개 이미지 url. 개수(1~4)에 맞춰 빈 칸 없이 꽉 채운다. 0개면 플레이스홀더.
//   컬렉션명은 길면 … (CSS ellipsis). 태그칩은 tags 배열.
//   ⋮ 옵션(컬렉션 수정/삭제)은 썸네일 밖 하단 제목 옆 — 프로젝트 카드와 통일, 상시 표시.
const MAX_THUMBS = 4;

const CollectionCard = ({
  collection,
  variant = "grid",
  onClick,
  onEdit,
  onDelete,
}) => {
  const thumbs = (collection.thumbnails ?? []).slice(0, MAX_THUMBS);
  const tags = collection.tags ?? [];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const hasMenu = !!(onEdit || onDelete);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const onKeyOpen = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  // 그리드/리스트 공용 ⋮ 옵션 메뉴 (컬렉션 수정/삭제).
  const menu = hasMenu && (
    <div
      className={styles.collCardMenuWrap}
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={styles.collCardMenuBtn}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((o) => !o);
        }}
        aria-label="컬렉션 옵션"
        aria-haspopup="true"
        aria-expanded={menuOpen}
      >
        <MoreIcon />
      </button>
      {menuOpen && (
        <div className={styles.collCardMenuDropdown}>
          {onEdit && (
            <button
              type="button"
              className={styles.collCardMenuItem}
              onClick={() => {
                setMenuOpen(false);
                onEdit(collection);
              }}
            >
              <EditIcon />
              <span>컬렉션 수정</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className={`${styles.collCardMenuItem} ${styles.collCardMenuDanger}`}
              onClick={() => {
                setMenuOpen(false);
                onDelete(collection);
              }}
            >
              <TrashIcon />
              <span>삭제하기</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ── 리스트 보기 — 한 줄에 작은 썸네일 + 이름 + 태그 + ⋮ ──
  if (variant === "list") {
    return (
      <div className={styles.collectionRow}>
        <div
          role="button"
          tabIndex={0}
          className={styles.collectionRowMain}
          onClick={onClick}
          onKeyDown={onKeyOpen}
          aria-label={`${collection.name} 컬렉션 열기`}
        >
          <div className={styles.rowThumb}>
            {thumbs.length === 0 ? (
              <div className={styles.rowThumbEmpty}>
                <ImagePlaceholderIcon />
              </div>
            ) : (
              <AuthedImage
                src={thumbs[0]}
                alt=""
                className={styles.rowThumbImg}
              />
            )}
          </div>
          <span className={styles.rowName}>{collection.name}</span>
          {tags.length > 0 && (
            <div className={styles.rowTags}>
              {tags.map((tag) => (
                <span key={tag} className={styles.tag}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        {menu}
      </div>
    );
  }

  // ── 그리드 보기(기본) — 모자이크 썸네일 + 이름 + 태그 ──
  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.collectionCard}
      onClick={onClick}
      onKeyDown={onKeyOpen}
      aria-label={`${collection.name} 컬렉션 열기`}
    >
      <div className={styles.collectionThumbBox}>
        {thumbs.length === 0 ? (
          <div className={styles.quadPlaceholder}>
            <ImagePlaceholderIcon />
          </div>
        ) : (
          <div
            className={`${styles.quadThumb} ${styles[`quad${thumbs.length}`]}`}
          >
            {thumbs.map((src, i) => (
              <AuthedImage
                key={i}
                src={src}
                alt=""
                className={styles.quadCell}
              />
            ))}
          </div>
        )}
      </div>

      {/* 썸네일 밖 하단 — (좌) 컬렉션명, (우) ⋮ 옵션. 프로젝트 카드와 통일. */}
      <div className={styles.collectionNameRow}>
        <span className={styles.collectionName}>{collection.name}</span>
        {menu}
      </div>

      {tags.length > 0 && (
        <div className={styles.tagRow}>
          {tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const ImagePlaceholderIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

// 프로젝트 목록과 동일한 옵션 메뉴 아이콘(색은 항목 color 상속).
const EditIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M2 16H3.425L13.2 6.225L11.775 4.8L2 14.575V16ZM0 18V13.75L13.2 0.575C13.4 0.391667 13.6208 0.25 13.8625 0.15C14.1042 0.05 14.3583 0 14.625 0C14.8917 0 15.15 0.05 15.4 0.15C15.65 0.25 15.8667 0.4 16.05 0.6L17.425 2C17.625 2.18333 17.7708 2.4 17.8625 2.65C17.9542 2.9 18 3.15 18 3.4C18 3.66667 17.9542 3.92083 17.8625 4.1625C17.7708 4.40417 17.625 4.625 17.425 4.825L4.25 18H0ZM12.475 5.525L11.775 4.8L13.2 6.225L12.475 5.525Z"
      fill="currentColor"
    />
  </svg>
);

const TrashIcon = () => (
  <svg
    width="15"
    height="16"
    viewBox="0 0 16 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3 18C2.45 18 1.97917 17.8042 1.5875 17.4125C1.19583 17.0208 1 16.55 1 16V3H0V1H5V0H11V1H16V3H15V16C15 16.55 14.8042 17.0208 14.4125 17.4125C14.0208 17.8042 13.55 18 13 18H3ZM13 3H3V16H13V3ZM5 14H7V5H5V14ZM9 14H11V5H9V14Z"
      fill="currentColor"
    />
  </svg>
);

// 프로젝트 목록과 동일한 세로 점 3개 옵션 아이콘.
const MoreIcon = () => (
  <svg
    width="4"
    height="16"
    viewBox="0 0 4 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M2 16C1.45 16 0.979167 15.8042 0.5875 15.4125C0.195833 15.0208 0 14.55 0 14C0 13.45 0.195833 12.9792 0.5875 12.5875C0.979167 12.1958 1.45 12 2 12C2.55 12 3.02083 12.1958 3.4125 12.5875C3.80417 12.9792 4 13.45 4 14C4 14.55 3.80417 15.0208 3.4125 15.4125C3.02083 15.8042 2.55 16 2 16ZM2 10C1.45 10 0.979167 9.80417 0.5875 9.4125C0.195833 9.02083 0 8.55 0 8C0 7.45 0.195833 6.97917 0.5875 6.5875C0.979167 6.19583 1.45 6 2 6C2.55 6 3.02083 6.19583 3.4125 6.5875C3.80417 6.97917 4 7.45 4 8C4 8.55 3.80417 9.02083 3.4125 9.4125C3.02083 9.80417 2.55 10 2 10ZM2 4C1.45 4 0.979167 3.80417 0.5875 3.4125C0.195833 3.02083 0 2.55 0 2C0 1.45 0.195833 0.979167 0.5875 0.5875C0.979167 0.195833 1.45 0 2 0C2.55 0 3.02083 0.195833 3.4125 0.5875C3.80417 0.979167 4 1.45 4 2C4 2.55 3.80417 3.02083 3.4125 3.4125C3.02083 3.80417 2.55 4 2 4Z"
      fill="currentColor"
    />
  </svg>
);

export default CollectionCard;
