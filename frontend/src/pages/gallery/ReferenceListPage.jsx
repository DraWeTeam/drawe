import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCollections, updateCollection, deleteCollection } from "./api";
import { track } from "../../analytics";
import CollectionCard from "./CollectionCard";
import CollectionEditModal from "./CollectionEditModal";
import DirectAddModal from "./DirectAddModal";
import ModalShell from "./ModalShell";
import styles from "./ArchivePage.module.css";
import modalStyles from "./CollectionDetailPage.module.css";

// SCR-ARCH-02 아카이브 목록(전체) — 레퍼런스 컬렉션 카드 그리드 + '직접 추가하기'.
//   아카이브 홈(/archive)의 '레퍼런스 전체보기' 목적지. 컬렉션 = 명명된 레퍼런스 그룹(명암/손 구도 등).
//   '직접 추가하기'는 이 전체보기 페이지에만 둔다(홈에는 없음).
const SORTS = [
  { key: "recent", label: "최근" },
  { key: "oldest", label: "오래된순" },
];

const ReferenceListPage = () => {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  // 보기 모드: "grid"(모자이크 카드) | "list"(한 줄). SCR-ARCH-02.
  const [view, setView] = useState("grid");
  // 정렬 키(최근/오래된순) + 드롭다운 열림. 백엔드가 최근순(createdAt DESC)으로 주므로
  // "recent"=원순서, "oldest"=뒤집기.
  const [sort, setSort] = useState("recent");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);
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

  // 바깥 클릭 시 정렬 드롭다운 닫기.
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [sortOpen]);

  const totalRefs = collections.reduce((sum, c) => sum + (c.count ?? 0), 0);

  // 정렬 — 백엔드가 최근순(createdAt DESC)으로 주므로 recent=원순서, oldest=뒤집기.
  const sorted = useMemo(
    () => (sort === "oldest" ? [...collections].reverse() : collections),
    [collections, sort],
  );
  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? "최근";

  // 컬렉션 수정 저장 — 로컬 목록에 즉시 반영. 성공 시 true 반환(모달이 닫힘 애니메이션 후 닫힘).
  const handleSaveEdit = async ({ name, description, tags }) => {
    if (!editTarget) return false;
    setBusy(true);
    try {
      await updateCollection(editTarget.id, { name, description, tags });
      setCollections((prev) =>
        prev.map((c) => (c.id === editTarget.id ? { ...c, name, tags } : c)),
      );
      return true;
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "컬렉션을 수정하지 못했어요.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  // 컬렉션 삭제 — 목록에서 제거. 성공 시 true 반환(모달이 닫힘 애니메이션 후 닫힘).
  const handleDelete = async () => {
    if (!deleteTarget) return false;
    setBusy(true);
    try {
      await deleteCollection(deleteTarget.id);
      setCollections((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      return true;
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "컬렉션을 삭제하지 못했어요.",
      );
      return false;
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
      </header>

      {/* 툴바 — (좌) 보기 전환 토글, (우) 정렬 + 직접 추가하기. 프로젝트 목록과 규격 통일. */}
      {!loading && !errorMessage && (
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <div className={styles.viewToggle}>
              <button
                type="button"
                className={`${styles.viewBtn} ${view === "grid" ? styles.viewBtnActive : ""}`}
                onClick={() => setView("grid")}
                aria-label="그리드 보기"
                aria-pressed={view === "grid"}
                title="그리드 보기"
              >
                <GridIcon />
              </button>
              <button
                type="button"
                className={`${styles.viewBtn} ${view === "list" ? styles.viewBtnActive : ""}`}
                onClick={() => setView("list")}
                aria-label="리스트 보기"
                aria-pressed={view === "list"}
                title="리스트 보기"
              >
                <ListIcon />
              </button>
            </div>
          </div>
          <div className={styles.toolbarRight}>
            <div className={styles.sortWrap} ref={sortRef}>
              <button
                type="button"
                className={styles.sortBtn}
                onClick={() => setSortOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={sortOpen}
              >
                {sortLabel}
                <span
                  className={`${styles.sortChevron} ${sortOpen ? styles.sortChevronOpen : ""}`}
                >
                  <ChevronDown />
                </span>
              </button>
              {sortOpen && (
                <div className={styles.sortDropdown} role="listbox">
                  {SORTS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      role="option"
                      aria-selected={sort === s.key}
                      className={`${styles.sortItem} ${sort === s.key ? styles.sortItemActive : ""}`}
                      onClick={() => {
                        setSort(s.key);
                        setSortOpen(false);
                        track("archive_sorted", {
                          category: "reference",
                          sort_type: "archived_date",
                          sort_order: s.key === "recent" ? "desc" : "asc",
                        });
                      }}
                    >
                      <span className={styles.sortCheck}>
                        {sort === s.key && <CheckIcon />}
                      </span>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => setShowAdd(true)}
            >
              <PlusIcon /> 직접 추가하기
            </button>
          </div>
        </div>
      )}

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
        <div
          className={
            view === "grid" ? styles.collectionGrid : styles.collectionList
          }
        >
          {sorted.map((c) => (
            <CollectionCard
              key={c.id}
              collection={c}
              variant={view}
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
        <ModalShell onClose={() => setDeleteTarget(null)} busy={busy}>
          {(requestClose) => {
            const confirmDelete = async () => {
              const ok = await handleDelete();
              if (ok !== false) requestClose();
            };
            return (
              <>
                <h3 className={modalStyles.modalTitle}>컬렉션을 삭제할까요?</h3>
                <p className={modalStyles.modalText}>
                  &lsquo;{deleteTarget.name}&rsquo; 컬렉션과 저장된 모든
                  레퍼런스가 삭제돼요. 이 작업은 되돌릴 수 없어요.
                </p>
                <div className={modalStyles.modalActions}>
                  <button
                    type="button"
                    className={modalStyles.modalCancel}
                    onClick={requestClose}
                    disabled={busy}
                  >
                    취소하기
                  </button>
                  <button
                    type="button"
                    className={modalStyles.modalConfirm}
                    onClick={confirmDelete}
                    disabled={busy}
                  >
                    삭제하기
                  </button>
                </div>
              </>
            );
          }}
        </ModalShell>
      )}
    </div>
  );
};

// 프로젝트 '새 프로젝트' 버튼과 동일한 채워진 + 아이콘.
const PlusIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path d="M8 18V10H0V8H8V0H10V8H18V10H10V18H8Z" fill="currentColor" />
  </svg>
);

const ChevronDown = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// 정렬 활성 항목 체크 — 프로젝트 목록과 동일.
const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5.25 9.4L2.85 7L2 7.85L5.25 11.1L12 4.35L11.15 3.5L5.25 9.4Z"
      fill="#FF8534"
    />
  </svg>
);

// 프로젝트 목록과 동일한 그리드/리스트 아이콘.
const GridIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M0 8V0H8V8H0ZM0 18V10H8V18H0ZM10 8V0H18V8H10ZM10 18V10H18V18H10ZM2 6H6V2H2V6ZM12 6H16V2H12V6ZM12 16H16V12H12V16ZM2 16H6V12H2V16Z"
      fill="currentColor"
    />
  </svg>
);

const ListIcon = () => (
  <svg
    width="18"
    height="12"
    viewBox="0 0 18 12"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M0 12V10H12V12H0ZM0 7V5H18V7H0ZM0 2V0H18V2H0Z"
      fill="currentColor"
    />
  </svg>
);

export default ReferenceListPage;
