import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getCollection,
  updateCollection,
  deleteCollection,
  togglePin,
  removeReferenceFromCollection,
} from "./api";
import { downloadImage } from "./download";
import AuthedImage from "../chat/AuthedImage";
import CollectionEditModal from "./CollectionEditModal";
import styles from "./CollectionDetailPage.module.css";

// SCR-ARCH-04 컬렉션 상세 — 헤더(뒤로/제목/⋮) + 필터 탭(전체/AI/사진/일러스트) + 레퍼런스 그리드.
//   필터는 Image.source 로 매핑: 사진=UNSPLASH, AI=AI, 일러스트=GUIDE_REF(가이드 코퍼스 자료).
//   ⋮(컬렉션 수정/삭제)와 카드 ⋮(고정/정보수정/아카이브취소)는 Phase 3~4 에서 배선.
const FILTERS = [
  { key: "ALL", label: "전체" },
  { key: "AI", label: "AI" },
  { key: "UNSPLASH", label: "사진" },
  { key: "GUIDE_REF", label: "일러스트" },
];

const CollectionDetailPage = () => {
  const { collectionId } = useParams();
  const navigate = useNavigate();
  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [downloadingIds, setDownloadingIds] = useState(() => new Set());
  // 헤더 ⋮ 메뉴 열림 여부.
  const [menuOpen, setMenuOpen] = useState(false);
  // 모달: null | "edit" | "delete".
  const [modal, setModal] = useState(null);
  // 수정/삭제 진행 중(버튼 중복 방지).
  const [busy, setBusy] = useState(false);
  // 카드 ⋮ 메뉴 열린 imageId (하나만).
  const [cardMenu, setCardMenu] = useState(null);
  const menuRef = useRef(null);
  const cardMenuRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const fetch = async () => {
      setLoading(true);
      setErrorMessage("");
      try {
        const data = await getCollection(collectionId);
        if (alive) setCollection(data);
      } catch (err) {
        if (alive)
          setErrorMessage(
            err.response?.data?.error?.message ||
              "컬렉션을 불러오지 못했어요.",
          );
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetch();
    return () => {
      alive = false;
    };
  }, [collectionId]);

  // 바깥 클릭 시 헤더 ⋮ 메뉴 닫기.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // 바깥 클릭 시 카드 ⋮ 메뉴 닫기.
  useEffect(() => {
    if (cardMenu == null) return;
    const onDown = (e) => {
      if (cardMenuRef.current && !cardMenuRef.current.contains(e.target)) {
        setCardMenu(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [cardMenu]);

  const handleSaveEdit = async ({ name, description, tags }) => {
    setBusy(true);
    try {
      await updateCollection(collectionId, { name, description, tags });
      setCollection((prev) => ({ ...prev, name, description, tags }));
      setModal(null);
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "컬렉션을 수정하지 못했어요.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteCollection(collectionId);
      navigate("/archive/references");
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "컬렉션을 삭제하지 못했어요.",
      );
      setBusy(false);
    }
  };

  // 고정하기 토글 — 로컬 state 반영 후 재정렬(고정 우선).
  const handleTogglePin = async (imageId) => {
    setCardMenu(null);
    try {
      await togglePin(collectionId, imageId);
      setCollection((prev) => {
        const references = prev.references.map((r) =>
          r.imageId === imageId ? { ...r, pinned: !r.pinned } : r,
        );
        // 고정 우선 정렬 유지(안정 정렬).
        references.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        return { ...prev, references };
      });
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "고정 상태를 바꾸지 못했어요.",
      );
    }
  };

  // 아카이브 취소 — 컬렉션에서 레퍼런스 제거.
  const handleRemove = async (imageId) => {
    setCardMenu(null);
    try {
      await removeReferenceFromCollection(collectionId, imageId);
      setCollection((prev) => ({
        ...prev,
        references: prev.references.filter((r) => r.imageId !== imageId),
      }));
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "아카이브를 취소하지 못했어요.",
      );
    }
  };

  const handleDownload = async (imageId, url) => {
    if (imageId == null || downloadingIds.has(imageId)) return;
    setDownloadingIds((prev) => new Set(prev).add(imageId));
    try {
      await downloadImage(imageId, url);
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
    }
  };

  const refs = collection?.references ?? [];
  const filtered = useMemo(
    () => (filter === "ALL" ? refs : refs.filter((r) => r.source === filter)),
    [refs, filter],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => navigate("/archive/references")}
          aria-label="뒤로"
        >
          <ChevronLeft />
        </button>
        <h1 className={styles.title}>{collection?.name ?? "컬렉션"}</h1>
        {!loading && !errorMessage && collection && (
          <div className={styles.headerMenu} ref={menuRef}>
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="컬렉션 옵션"
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              <MoreIcon />
            </button>
            {menuOpen && (
              <div className={styles.menuDropdown}>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    setModal("edit");
                  }}
                >
                  <EditIcon /> 컬렉션 수정
                </button>
                <button
                  type="button"
                  className={`${styles.menuItem} ${styles.menuDanger}`}
                  onClick={() => {
                    setMenuOpen(false);
                    setModal("delete");
                  }}
                >
                  <TrashIcon /> 삭제하기
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {loading ? (
        <div className={styles.stateBox}>불러오는 중…</div>
      ) : errorMessage ? (
        <div className={styles.stateBox}>{errorMessage}</div>
      ) : (
        <>
          {/* 필터 탭 (전체/AI/사진/일러스트) */}
          <div className={styles.filterRow}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`${styles.filterChip} ${filter === f.key ? styles.filterActive : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className={styles.stateBox}>
              {refs.length === 0
                ? "아직 이 컬렉션에 담긴 레퍼런스가 없어요."
                : "이 필터에 해당하는 레퍼런스가 없어요."}
            </div>
          ) : (
            <div className={styles.grid}>
              {filtered.map((ref) => (
                <div key={ref.imageId} className={styles.card}>
                  <AuthedImage
                    src={ref.url}
                    alt="레퍼런스"
                    className={styles.thumb}
                  />
                  {ref.pinned && (
                    <span className={styles.pinBadge} title="고정됨">
                      <PinIcon />
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.downloadBtn}
                    onClick={() => handleDownload(ref.imageId, ref.url)}
                    disabled={downloadingIds.has(ref.imageId)}
                    aria-label="이미지 다운로드"
                    title="다운로드"
                  >
                    <DownloadIcon />
                  </button>
                  <div
                    className={styles.cardMenuWrap}
                    ref={cardMenu === ref.imageId ? cardMenuRef : null}
                  >
                    <button
                      type="button"
                      className={styles.cardMenuBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCardMenu((cur) =>
                          cur === ref.imageId ? null : ref.imageId,
                        );
                      }}
                      aria-label="레퍼런스 옵션"
                      aria-haspopup="true"
                      aria-expanded={cardMenu === ref.imageId}
                    >
                      <MoreIcon />
                    </button>
                    {cardMenu === ref.imageId && (
                      <div className={styles.cardMenuDropdown}>
                        <button
                          type="button"
                          className={styles.menuItem}
                          onClick={() => handleTogglePin(ref.imageId)}
                        >
                          {ref.pinned ? "고정 해제" : "고정하기"}
                        </button>
                        <button
                          type="button"
                          className={`${styles.menuItem} ${styles.menuDanger}`}
                          onClick={() => handleRemove(ref.imageId)}
                        >
                          아카이브 취소
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 컬렉션 수정 모달 (SCR-ARCH-06) */}
      {modal === "edit" && collection && (
        <CollectionEditModal
          collection={collection}
          busy={busy}
          onCancel={() => setModal(null)}
          onSave={handleSaveEdit}
        />
      )}

      {/* 컬렉션 삭제 확인 모달 (SCR-ARCH-06) */}
      {modal === "delete" && collection && (
        <div
          className={styles.modalOverlay}
          onClick={() => !busy && setModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>컬렉션을 삭제할까요?</h3>
            <p className={styles.modalText}>
              &lsquo;{collection.name}&rsquo; 컬렉션과 저장된 모든 레퍼런스가
              삭제돼요. 이 작업은 되돌릴 수 없어요.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancel}
                onClick={() => setModal(null)}
                disabled={busy}
              >
                취소하기
              </button>
              <button
                type="button"
                className={styles.modalConfirm}
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

const ChevronLeft = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const PinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16 3l5 5-4 1-3 3-1 5-2-2-4 4-1-1 4-4-2-2 5-1 3-3 1-4z" />
  </svg>
);

const MoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </svg>
);

const EditIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const TrashIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const DownloadIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 22 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10.6667 16.1557L4.15567 9.64433L5.73333 8.04433L9.55567 11.8667V0H11.7777V11.8667L15.6 8.04433L17.1777 9.64433L10.6667 16.1557ZM2.22233 21.3333C1.62233 21.3333 1.10189 21.113 0.661 20.6723C0.220333 20.2314 0 19.711 0 19.111V14.6H2.22233V19.111H19.111V14.6H21.3333V19.111C21.3333 19.711 21.113 20.2314 20.6723 20.6723C20.2314 21.113 19.711 21.3333 19.111 21.3333H2.22233Z"
      fill="currentColor"
    />
  </svg>
);

export default CollectionDetailPage;
