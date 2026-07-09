import { useEffect, useState } from "react";
import {
  getCollections,
  createCollection,
  addReferenceToCollection,
  removeReferenceFromCollection,
  deleteCollection,
} from "./api";
import { notifyArchiveChanged } from "./archiveEvents";
import { useToast } from "../../components/ToastContext";
import TagChipEditor from "./TagChipEditor";
import styles from "./ArchiveToCollectionModal.module.css";

// 레퍼런스를 컬렉션에 저장하는 공용 모달(SCR-ARCH-05 아카이브 저장).
//   레퍼런스 보드/상세 등 어디서든 imageId 하나를 받아 컬렉션 선택 → 신규 collections 에 저장한다.
const ArchiveToCollectionModal = ({ imageId, onClose, onSaved, onUndone }) => {
  const { showToast } = useToast();
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savedTo, setSavedTo] = useState(() => new Set());
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTags, setNewTags] = useState([]);
  const [tagDraft, setTagDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getCollections();
        if (alive) setCollections(data?.collections ?? []);
      } catch {
        /* 무시 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [imageId]);

  // 저장 성공 시 상단 중앙 토스트 + '실행 취소'.
  //   undo: 기존 컬렉션이면 그 레퍼런스만 제거, 방금 만든 컬렉션이면 컬렉션째 삭제.
  const showSavedToast = (undo) => {
    showToast({
      message: "아카이브에 저장되었습니다.",
      actionLabel: "실행 취소",
      onAction: async () => {
        try {
          await undo();
          notifyArchiveChanged();
          onUndone?.(Number(imageId));
        } catch {
          /* 무시 — 취소 실패는 조용히 */
        }
      },
    });
  };

  const saveTo = async (collectionId) => {
    try {
      await addReferenceToCollection(collectionId, Number(imageId));
      setSavedTo((prev) => new Set(prev).add(collectionId));
      notifyArchiveChanged();
      onSaved?.(collectionId);
      showSavedToast(() =>
        removeReferenceFromCollection(collectionId, Number(imageId)),
      );
    } catch (err) {
      setError(
        err.response?.data?.error?.message || "아카이브에 저장하지 못했어요.",
      );
    }
  };

  const createAndSave = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const data = await createCollection({
        name,
        imageIds: [Number(imageId)],
        tags: newTags,
      });
      notifyArchiveChanged();
      onSaved?.(data?.collectionId, { created: true });
      onClose();
      const newId = data?.collectionId;
      if (newId != null) showSavedToast(() => deleteCollection(newId));
    } catch (err) {
      setError(
        err.response?.data?.error?.message || "컬렉션을 만들지 못했어요.",
      );
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h3 className={styles.title}>컬렉션에 저장</h3>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className={styles.state}>불러오는 중…</div>
        ) : (
          <div className={styles.list}>
            {collections.length === 0 && (
              <div className={styles.state}>
                아직 컬렉션이 없어요. 아래에서 새로 만들어보세요.
              </div>
            )}
            {collections.map((c) => {
              const saved = savedTo.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={styles.item}
                  onClick={() => saveTo(c.id)}
                  disabled={saved}
                >
                  <span className={styles.itemName}>{c.name}</span>
                  <span className={styles.itemRight}>
                    <span className={styles.itemCount}>{c.count ?? 0}개</span>
                    {saved && <span className={styles.savedMark}>저장됨</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {creatingNew ? (
          <div className={styles.newBox}>
            <div className={styles.newRow}>
              <input
                className={styles.newInput}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndSave()}
                placeholder="새 컬렉션 이름"
                autoFocus
                maxLength={100}
              />
              <button
                type="button"
                className={styles.newSave}
                onClick={createAndSave}
                disabled={!newName.trim()}
              >
                만들고 저장
              </button>
            </div>
            <TagChipEditor
              tags={newTags}
              draft={tagDraft}
              onChange={setNewTags}
              onDraftChange={setTagDraft}
              placeholder="태그 추가 (선택)"
            />
          </div>
        ) : (
          <button
            type="button"
            className={styles.newBtn}
            onClick={() => setCreatingNew(true)}
          >
            + 새 컬렉션
          </button>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
};

export default ArchiveToCollectionModal;
