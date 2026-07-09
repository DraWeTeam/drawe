import { useState } from "react";
import TagChipEditor from "./TagChipEditor";
import ModalShell from "./ModalShell";
import styles from "./CollectionDetailPage.module.css";

// SCR-ARCH-06 컬렉션 수정 모달 — 이름[입력] + 설명[textarea] + 태그[칩 편집].
//   태그는 사용자가 직접 추가/삭제(Enter/쉼표로 추가, 칩 X 로 삭제).
//   onSave 는 async(성공 시 resolve). 성공하면 닫힘 애니메이션 후 언마운트한다.
const CollectionEditModal = ({ collection, busy, onCancel, onSave }) => {
  const [name, setName] = useState(collection.name ?? "");
  const [description, setDescription] = useState(collection.description ?? "");
  const [tags, setTags] = useState(collection.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");

  const canSave = name.trim().length > 0 && !busy;

  return (
    <ModalShell
      onClose={onCancel}
      busy={busy}
      modalClassName={styles.modalWide}
    >
      {(requestClose) => {
        const submit = async () => {
          if (!canSave) return;
          const ok = await onSave({
            name: name.trim(),
            description: description.trim(),
            tags,
          });
          // onSave 가 성공 여부를 반환하지 않으면(undefined) 성공으로 간주하고 닫는다.
          if (ok !== false) requestClose();
        };

        return (
          <>
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
                onClick={requestClose}
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
          </>
        );
      }}
    </ModalShell>
  );
};

export default CollectionEditModal;
