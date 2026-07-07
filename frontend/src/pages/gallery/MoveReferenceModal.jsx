import { useEffect, useState } from "react";
import { getCollections } from "./api";
import styles from "./CollectionDetailPage.module.css";

// SCR-ARCH-05 카드 ⋮ '정보 수정'(아카이브 위치 변경) — 레퍼런스를 다른 컬렉션으로 이동.
//   내 컬렉션 목록을 불러와 현재 컬렉션을 제외하고 대상 하나를 고른다. 저장 시 상위가 move API 호출.
const MoveReferenceModal = ({ currentCollectionId, busy, onCancel, onMove }) => {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getCollections();
        if (alive) setCollections(data?.collections ?? []);
      } catch {
        /* 무시 — 빈 목록으로 처리 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 현재 컬렉션은 이동 대상에서 제외.
  const targets = collections.filter(
    (c) => String(c.id) !== String(currentCollectionId),
  );

  const canMove = selected != null && !busy;

  return (
    <div
      className={styles.modalOverlay}
      onClick={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>다른 컬렉션으로 이동</h3>
        <p className={styles.modalText}>
          이 레퍼런스를 옮길 컬렉션을 선택해주세요.
        </p>

        {loading ? (
          <div className={styles.moveEmpty}>불러오는 중…</div>
        ) : targets.length === 0 ? (
          <div className={styles.moveEmpty}>이동할 다른 컬렉션이 없어요.</div>
        ) : (
          <div className={styles.moveList}>
            {targets.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.moveItem} ${
                  selected === c.id ? styles.moveItemActive : ""
                }`}
                onClick={() => setSelected(c.id)}
              >
                <span className={styles.moveItemName}>{c.name}</span>
                <span className={styles.moveItemCount}>{c.count ?? 0}개</span>
              </button>
            ))}
          </div>
        )}

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
            onClick={() => canMove && onMove(selected)}
            disabled={!canMove}
          >
            이동하기
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoveReferenceModal;
