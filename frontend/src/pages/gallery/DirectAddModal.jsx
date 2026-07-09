import { useState } from "react";
import { createCollection } from "./api";
import TagChipEditor from "./TagChipEditor";
import ModalShell from "./ModalShell";
import styles from "./CollectionDetailPage.module.css";

// SCR-ARCH-02 '직접 추가하기' — 새 컬렉션을 만든다(이름 + 태그).
//   레퍼런스는 아카이브 저장 시 담기므로, 생성 시엔 이미지 업로드 없이 빈 컬렉션을 만든다.
const DirectAddModal = ({ onCancel, onCreated }) => {
  const [name, setName] = useState("");
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = name.trim() && !busy;

  return (
    <ModalShell
      onClose={onCancel}
      busy={busy}
      modalClassName={styles.modalWide}
    >
      {(requestClose) => {
        const submit = async () => {
          if (!canSubmit) return;
          setBusy(true);
          setError("");
          try {
            const res = await createCollection({ name: name.trim(), tags });
            // 생성 성공 → 부모가 새 컬렉션으로 이동/재조회(페이지 전환이라 닫힘 애니메이션 불필요).
            onCreated?.(res?.collectionId);
          } catch (err) {
            setError(
              err.response?.data?.error?.message ||
                err.message ||
                "컬렉션을 만들지 못했어요.",
            );
            setBusy(false);
          }
        };

        return (
          <>
            <h3 className={styles.modalTitle}>직접 추가하기</h3>

            <label className={styles.fieldLabel}>컬렉션 이름</label>
            <input
              className={styles.textInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="새 컬렉션 이름"
              autoFocus
            />

            <label className={styles.fieldLabel}>태그</label>
            <p className={styles.fieldHint}>
              컬렉션을 설명하는 태그를 직접 입력하세요. (Enter로 추가)
            </p>
            <TagChipEditor
              tags={tags}
              draft={tagDraft}
              onChange={setTags}
              onDraftChange={setTagDraft}
            />

            {error && <p className={styles.modalError}>{error}</p>}

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
                disabled={!canSubmit}
              >
                {busy ? "만드는 중…" : "추가하기"}
              </button>
            </div>
          </>
        );
      }}
    </ModalShell>
  );
};

export default DirectAddModal;
