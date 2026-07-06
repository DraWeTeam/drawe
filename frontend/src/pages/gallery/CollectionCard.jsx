import AuthedImage from "../chat/AuthedImage";
import styles from "./ArchivePage.module.css";

// SCR-ARCH-02 컬렉션 카드 — 4분할 썸네일 + 컬렉션명 + 태그칩.
//   thumbnails 는 앞 최대 4개 이미지 url. 4개 미만이면 남는 칸은 빈 셀. 0개면 플레이스홀더.
//   컬렉션명은 길면 … (CSS ellipsis). 태그칩은 tags 배열.
const QUAD = 4;

const CollectionCard = ({ collection, onClick }) => {
  const thumbs = collection.thumbnails ?? [];
  const tags = collection.tags ?? [];

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

export default CollectionCard;
