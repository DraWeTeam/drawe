import { useEffect, useState } from "react";
import {
  getCollections,
  getReferenceSuggestion,
  createCollection,
  addReferenceToCollection,
} from "./api";
import { notifyArchiveChanged } from "./archiveEvents";
import styles from "./ArchiveToCollectionModal.module.css";

// 레퍼런스를 컬렉션에 저장하는 공용 모달(SCR-ARCH-05 아카이브 저장).
//   레퍼런스 보드/상세 등 어디서든 imageId 하나를 받아 컬렉션 선택 → 신규 collections 에 저장한다.
//   CLIP 추천(레벨3)을 조회해 추천 컬렉션을 맨 위로 올리고 '추천' 배지를 붙인다. 추천 축 컬렉션이
//   아직 없으면 새 컬렉션 이름을 축 라벨로 프리필한다.
const ArchiveToCollectionModal = ({ imageId, onClose, onSaved }) => {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suggestion, setSuggestion] = useState(null);
  const [savedTo, setSavedTo] = useState(() => new Set());
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
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
      // 추천은 실패해도 무시(추천 없이 정상 동작).
      try {
        const s = await getReferenceSuggestion(imageId);
        if (alive) {
          setSuggestion(s ?? { axisId: null });
          if (s?.axisLabel && !s?.collectionId) setNewName(s.axisLabel);
        }
      } catch {
        if (alive) setSuggestion({ axisId: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, [imageId]);

  const ordered = (() => {
    const sid = suggestion?.collectionId;
    if (sid == null) return collections;
    const hit = collections.find((c) => c.id === sid);
    return hit ? [hit, ...collections.filter((c) => c.id !== sid)] : collections;
  })();

  const saveTo = async (collectionId) => {
    try {
      await addReferenceToCollection(collectionId, Number(imageId));
      setSavedTo((prev) => new Set(prev).add(collectionId));
      notifyArchiveChanged();
      onSaved?.(collectionId);
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
      });
      notifyArchiveChanged();
      onSaved?.(data?.collectionId, { created: true });
      onClose();
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
            {ordered.length === 0 && (
              <div className={styles.state}>
                아직 컬렉션이 없어요. 아래에서 새로 만들어보세요.
              </div>
            )}
            {ordered.map((c) => {
              const recommended =
                suggestion?.collectionId != null &&
                c.id === suggestion.collectionId;
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
                    {saved ? (
                      <span className={styles.savedMark}>저장됨</span>
                    ) : (
                      recommended && (
                        <span className={styles.recoMark}>추천</span>
                      )
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {suggestion?.axisLabel && !suggestion?.collectionId && !creatingNew && (
          <p className={styles.recoHint}>
            추천: <b>{suggestion.axisLabel}</b> 컬렉션으로 저장하기
          </p>
        )}

        {creatingNew ? (
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
