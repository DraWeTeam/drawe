import styles from "./TagChipEditor.module.css";

// 컬렉션 태그 칩 편집기(공용) — 사용자가 태그를 직접 추가/삭제.
//   Enter/쉼표로 추가, 칩 X 로 삭제, 빈 입력에서 Backspace 로 마지막 칩 삭제.
//   상태(tags/draft)는 부모가 소유한다(제어 컴포넌트).
const TagChipEditor = ({ tags, draft, onChange, onDraftChange, placeholder }) => {
  const addTag = () => {
    const t = draft.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    onDraftChange("");
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className={styles.tagEditor}>
      {tags.map((tag) => (
        <span key={tag} className={styles.tagChip}>
          {tag}
          <button
            type="button"
            className={styles.tagRemove}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            aria-label={`${tag} 태그 삭제`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className={styles.tagInput}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={addTag}
        placeholder={placeholder ?? "태그 입력 후 Enter"}
      />
      <button
        type="button"
        className={styles.tagAddBtn}
        onClick={addTag}
        disabled={!draft.trim()}
        aria-label="태그 추가"
      >
        추가
      </button>
    </div>
  );
};

export default TagChipEditor;
