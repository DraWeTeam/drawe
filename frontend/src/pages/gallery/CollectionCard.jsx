import { useEffect, useRef, useState } from "react";
import AuthedImage from "../chat/AuthedImage";
import styles from "./ArchivePage.module.css";

// SCR-ARCH-02 컬렉션 카드 — 4분할 썸네일 + 컬렉션명 + 태그칩.
//   thumbnails 는 앞 최대 4개 이미지 url. 4개 미만이면 남는 칸은 빈 셀. 0개면 플레이스홀더.
//   컬렉션명은 길면 … (CSS ellipsis). 태그칩은 tags 배열.
//   썸네일 우하단에 ⋮ 옵션(컬렉션 수정/삭제) — 아이패드/터치 기반이라 상시 표시.
const QUAD = 4;

const CollectionCard = ({ collection, onClick, onEdit, onDelete }) => {
  const thumbs = collection.thumbnails ?? [];
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

  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.collectionCard}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-label={`${collection.name} 컬렉션 열기`}
    >
      <div className={styles.collectionThumbBox}>
        {thumbs.length === 0 ? (
          <div className={styles.quadPlaceholder}>
            <ImagePlaceholderIcon />
          </div>
        ) : (
          <div className={styles.quadThumb}>
            {Array.from({ length: QUAD }).map((_, i) =>
              thumbs[i] ? (
                <AuthedImage
                  key={i}
                  src={thumbs[i]}
                  alt=""
                  className={styles.quadCell}
                />
              ) : (
                <div key={i} className={styles.quadEmpty} />
              ),
            )}
          </div>
        )}

        {hasMenu && (
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
                    컬렉션 수정
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
                    삭제하기
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <span className={styles.collectionName}>{collection.name}</span>
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

const MoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </svg>
);

export default CollectionCard;
