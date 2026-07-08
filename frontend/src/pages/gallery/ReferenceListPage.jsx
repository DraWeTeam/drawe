import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCollections, updateCollection, deleteCollection } from "./api";
import CollectionCard from "./CollectionCard";
import CollectionEditModal from "./CollectionEditModal";
import DirectAddModal from "./DirectAddModal";
import styles from "./ArchivePage.module.css";
import modalStyles from "./CollectionDetailPage.module.css";

// SCR-ARCH-02 아카이브 목록(전체) — 레퍼런스 컬렉션 카드 그리드 + '직접 추가하기'.
//   아카이브 홈(/archive)의 '레퍼런스 전체보기' 목적지. 컬렉션 = 명명된 레퍼런스 그룹(명암/손 구도 등).
//   '직접 추가하기'는 이 전체보기 페이지에만 둔다(홈에는 없음).
const ReferenceListPage = () => {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  // 카드 ⋮ → 수정/삭제 대상 컬렉션.
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadCollections = async (alive = { v: true }) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await getCollections();
      if (alive.v) setCollections(data?.collections ?? []);
    } catch (err) {
      if (alive.v) {
        setErrorMessage(
          err.response?.data?.error?.message || "아카이브를 불러오지 못했어요.",
        );
      }
    } finally {
      if (alive.v) setLoading(false);
    }
  };

  useEffect(() => {
    const alive = { v: true };
    loadCollections(alive);
    return () => {
      alive.v = false;
    };
  }, []);

  const totalRefs = collections.reduce((sum, c) => sum + (c.count ?? 0), 0);

  // 컬렉션 수정 저장 — 로컬 목록에 즉시 반영.
  const handleSaveEdit = async ({ name, description, tags }) => {
    if (!editTarget) return;
    setBusy(true);
    try {
      await updateCollection(editTarget.id, { name, description, tags });
      setCollections((prev) =>
        prev.map((c) => (c.id === editTarget.id ? { ...c, name, tags } : c)),
      );
      setEditTarget(null);
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "컬렉션을 수정하지 못했어요.",
      );
    } finally {
      setBusy(false);
    }
  };

  // 컬렉션 삭제 — 목록에서 제거.
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteCollection(deleteTarget.id);
      setCollections((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "컬렉션을 삭제하지 못했어요.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>레퍼런스</h1>
        {!loading && !errorMessage && collections.length > 0 && (
          <span className={styles.subtitle}>
            {collections.length}개 컬렉션 · 총 {totalRefs}개의 레퍼런스
          </span>
        )}
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => setShowAdd(true)}
          >
            <PlusIcon /> 직접 추가하기
          </button>
        </div>
      </header>

      {loading ? (
        <div className={styles.stateBox}>불러오는 중…</div>
      ) : errorMessage ? (
        <div className={styles.stateBox}>{errorMessage}</div>
      ) : collections.length === 0 ? (
        <div className={styles.stateBox}>
          아직 저장된 레퍼런스가 없어요.
          <br />
          마음에 드는 레퍼런스를 아카이브 해보세요.
        </div>
      ) : (
        <div className={styles.collectionGrid}>
          {collections.map((c) => (
            <CollectionCard
              key={c.id}
              collection={c}
              onClick={() => navigate(`/archive/collections/${c.id}`)}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <DirectAddModal
          onCancel={() => setShowAdd(false)}
          onCreated={(id) => {
            setShowAdd(false);
            if (id) navigate(`/archive/collections/${id}`);
            else loadCollections();
          }}
        />
      )}

      {/* 카드 ⋮ 컬렉션 수정 모달 */}
      {editTarget && (
        <CollectionEditModal
          collection={editTarget}
          busy={busy}
          onCancel={() => setEditTarget(null)}
          onSave={handleSaveEdit}
        />
      )}

      {/* 카드 ⋮ 컬렉션 삭제 확인 모달 */}
      {deleteTarget && (
        <div
          className={modalStyles.modalOverlay}
          onClick={() => !busy && setDeleteTarget(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={modalStyles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={modalStyles.modalTitle}>컬렉션을 삭제할까요?</h3>
            <p className={modalStyles.modalText}>
              &lsquo;{deleteTarget.name}&rsquo; 컬렉션과 저장된 모든 레퍼런스가
              삭제돼요. 이 작업은 되돌릴 수 없어요.
            </p>
            <div className={modalStyles.modalActions}>
              <button
                type="button"
                className={modalStyles.modalCancel}
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
              >
                취소하기
              </button>
              <button
                type="button"
                className={modalStyles.modalConfirm}
                onClick={handleDelete}
                disabled={busy}
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PlusIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export default ReferenceListPage;
