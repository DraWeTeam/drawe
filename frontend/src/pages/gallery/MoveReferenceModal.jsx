import { useEffect, useState } from "react";
import { getCollections } from "./api";
import TagChipEditor from "./TagChipEditor";
import ModalShell from "./ModalShell";
import styles from "./CollectionDetailPage.module.css";

// SCR-ARCH-05 카드 ⋮ '정보 수정' — 이 레퍼런스의 사용자 태그 편집 + (선택) 다른 컬렉션으로 이동.
//   태그는 이미지 단위 사용자 태그(컬렉션 자동분류 태그와 별개). 저장 시 상위가 updateReferenceInfo 호출.
//   currentTags: 이 레퍼런스에 이미 달린 사용자 태그(초기값).
const MoveReferenceModal = ({
  currentCollectionId,
  currentTags = [],
  busy,
  onCancel,
  onSave,
}) => {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // 이동 대상 컬렉션 id(없으면 이동 안 함)
  const [tags, setTags] = useState(() => [...currentTags]);
  const [tagDraft, setTagDraft] = useState("");

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

  return (
    <ModalShell onClose={onCancel} busy={busy}>
      {(requestClose) => {
        // 저장 — 태그는 항상 전달, 이동은 선택(대상 고른 경우만). 성공 시 닫힘 애니메이션 후 언마운트.
        const handleSave = async () => {
          if (busy) return;
          const ok = await onSave({
            targetCollectionId: selected,
            userTags: tags,
          });
          if (ok !== false) requestClose();
        };

        return (
          <>
            <h3 className={styles.modalTitle}>레퍼런스 정보 수정</h3>

            {/* 태그 편집 — 이 레퍼런스에 직접 태그 추가/수정 */}
            <p className={styles.modalLabel}>태그</p>
            <TagChipEditor
              tags={tags}
              draft={tagDraft}
              onChange={setTags}
              onDraftChange={setTagDraft}
              placeholder="태그 추가 (Enter)"
            />

            {/* 컬렉션 이동(선택) */}
            <p className={styles.modalLabel}>다른 컬렉션으로 이동 (선택)</p>
            {loading ? (
              <div className={styles.moveEmpty}>불러오는 중…</div>
            ) : targets.length === 0 ? (
              <div className={styles.moveEmpty}>
                이동할 다른 컬렉션이 없어요.
              </div>
            ) : (
              <div className={styles.moveList}>
                {targets.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.moveItem} ${
                      selected === c.id ? styles.moveItemActive : ""
                    }`}
                    // 다시 누르면 이동 취소(선택 해제).
                    onClick={() =>
                      setSelected((cur) => (cur === c.id ? null : c.id))
                    }
                  >
                    <span className={styles.moveItemName}>{c.name}</span>
                    <span className={styles.moveItemCount}>
                      {c.count ?? 0}개
                    </span>
                  </button>
                ))}
              </div>
            )}

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
                onClick={handleSave}
                disabled={busy}
              >
                {selected != null ? "저장 후 이동" : "저장하기"}
              </button>
            </div>
          </>
        );
      }}
    </ModalShell>
  );
};

export default MoveReferenceModal;
