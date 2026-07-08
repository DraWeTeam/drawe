import { useState } from "react";
import TagChipEditor from "./TagChipEditor";
import styles from "./CollectionDetailPage.module.css";

// SCR-ARCH-06 컬렉션 수정 모달 — 이름[입력] + 설명[textarea] + 태그[칩 편집].
//   태그는 사용자가 직접 추가/삭제(Enter/쉼표로 추가, 칩 X 로 삭제).
const CollectionEditModal = ({ collection, busy, onCancel, onSave }) => {
  const [name, setName] = useState(collection.name ?? "");
  const [description, setDescription] = useState(collection.description ?? "");
  const [tags, setTags] = useState(collection.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");

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
          컬렉션을 설명하는 태그를 직접 추가하거나 X로 삭제할 수 있어요.
        </p>
        <TagChipEditor
          tags={tags}
          draft={tagDraft}
          onChange={setTags}
          onDraftChange={setTagDraft}
        />

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
