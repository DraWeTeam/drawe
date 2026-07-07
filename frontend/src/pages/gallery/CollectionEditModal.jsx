import { useState } from "react";
import styles from "./CollectionDetailPage.module.css";

// SCR-ARCH-06 컬렉션 수정 모달 — 이름[입력] + 설명[textarea] + 태그[칩 편집].
//   스펙 모달엔 이름/설명만 있으나, 자동분류 태그를 사용자가 보정할 수 있도록 태그 편집란을 추가(우리 결정).
//   태그는 Enter/쉼표로 추가, 칩 X 로 삭제.
const CollectionEditModal = ({ collection, busy, onCancel, onSave }) => {
  const [name, setName] = useState(collection.name ?? "");
  const [description, setDescription] = useState(collection.description ?? "");
  const [tags, setTags] = useState(collection.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");

  const addTag = () => {
    const t = tagDraft.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagDraft("");
  };

  const onTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagDraft && tags.length) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const canSave = name.trim().length > 0 && !busy;

  const submit = () => {
    if (!canSave) return;
    onSave({ name: name.trim(), description: description.trim(), tags });
  };

  return (
    <div
      className={styles.modalOverlay}
      onClick={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`${styles.modal} ${styles.modalWide}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.modalTitle}>컬렉션 수정</h3>

        <label className={styles.fieldLabel}>컬렉션 이름</label>
        <input
          className={styles.textInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="컬렉션 이름"
        />

        <label className={styles.fieldLabel}>설명</label>
        <textarea
          className={styles.textArea}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={255}
          rows={3}
          placeholder="컬렉션에 대한 설명을 자유롭게 적어주세요."
        />

        <label className={styles.fieldLabel}>태그</label>
        <p className={styles.fieldHint}>
          자동으로 분류된 태그예요. 직접 추가하거나 X로 삭제할 수 있어요.
        </p>
        <div className={styles.tagEditor}>
          {tags.map((tag) => (
            <span key={tag} className={styles.tagChip}>
              {tag}
              <button
                type="button"
                className={styles.tagRemove}
                onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                aria-label={`${tag} 태그 삭제`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            className={styles.tagInput}
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={onTagKeyDown}
            onBlur={addTag}
            placeholder="태그 입력 후 Enter"
          />
          <button
            type="button"
            className={styles.tagAddBtn}
            onClick={addTag}
            disabled={!tagDraft.trim()}
            aria-label="태그 추가"
          >
            추가
          </button>
        </div>

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.modalCancel}
            onClick={onCancel}
            disabled={busy}
          >
            취소하기
          </button>
          <button
            type="button"
            className={styles.modalSave}
            onClick={submit}
            disabled={!canSave}
          >
            저장하기
          </button>
        </div>
      </div>
    </div>
  );
};

export default CollectionEditModal;
