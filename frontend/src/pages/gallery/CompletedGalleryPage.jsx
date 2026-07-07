import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCompletedGallery } from "./api";
import { downloadImage } from "./download";
import AuthedImage from "../chat/AuthedImage";
import styles from "./CompletedGalleryPage.module.css";

const PAGE_SIZE = 20;

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}.${mm}.${dd}`;
};

const CompletedGalleryPage = () => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [initialized, setInitialized] = useState(false);
  // 다운로드 중인 imageId 집합 (버튼 중복 클릭 방지)
  const [downloadingIds, setDownloadingIds] = useState(() => new Set());
  // 정본(70:28528) 헤더 컨트롤: 그리드/리스트 보기 · 정렬.
  const [view, setView] = useState("grid"); // "grid" | "list"
  const [menuOpenId, setMenuOpenId] = useState(null); // 카드 옵션(⋮) 메뉴 열린 projectId

  // 카드 옵션 메뉴 — 바깥 클릭/ESC 로 닫기.
  useEffect(() => {
    if (menuOpenId == null) return undefined;
    const close = () => setMenuOpenId(null);
    const onKey = (e) => e.key === "Escape" && setMenuOpenId(null);
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpenId]);
  const [sortDesc, setSortDesc] = useState(true); // 최근순(기본) ↔ 오래된순
  const navigate = useNavigate();

  // 다음 페이지 로드. 중복 호출은 loading 가드로 막는다.
  const loadMore = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await getCompletedGallery({ page, size: PAGE_SIZE });
      // projectId 기준 dedup — 어떤 경로로든 같은 항목이 중복 추가되지 않게 한다.
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.projectId));
        const fresh = (data?.items ?? []).filter(
          (it) => !seen.has(it.projectId),
        );
        return [...prev, ...fresh];
      });
      setTotal(data?.total ?? 0);
      setHasMore(Boolean(data?.hasMore));
      setPage((p) => p + 1);
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "갤러리를 불러오지 못했어요.",
      );
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, [loading, page]);

  // 최초 1회 로드. StrictMode(dev)의 effect 이중 실행으로 page=0 이 두 번
  // 불려 같은 항목이 중복 append 되는 것을 ref 가드로 막는다.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 무한 스크롤 — 바닥 센티넬이 보이면 다음 페이지 로드
  const sentinelRef = useRef(null);
  useEffect(() => {
    if (!hasMore || loading) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  // 완성 그림 서빙 경로 "/images/{id}" 에서 이미지 id 를 뽑는다.
  const imageIdFromUrl = (url) => {
    const m = /\/images\/(\d+)/.exec(url || "");
    return m ? Number(m[1]) : null;
  };

  const handleDownload = async (drawingUrl) => {
    const imageId = imageIdFromUrl(drawingUrl);
    if (imageId == null || downloadingIds.has(imageId)) return;
    setDownloadingIds((prev) => new Set(prev).add(imageId));
    try {
      // 완성 그림은 업로드된 서버 저장 이미지 — id 로 다운로드된다.
      await downloadImage(imageId, drawingUrl);
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
    }
  };

  const isEmpty = initialized && !errorMessage && items.length === 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headLeft}>
          <h1 className={styles.title}>완성작 갤러리</h1>
          {initialized && !errorMessage && items.length > 0 && (
            <span className={styles.subtitle}>총 {total}개의 완성작</span>
          )}
        </div>
      </header>

      {/* Figma 70:28532 툴바 행 — 좌: 보기전환 토글 / 우: 정렬 + 새 프로젝트 (타이틀 아래 별도 행) */}
      {initialized && !errorMessage && items.length > 0 && (
        <div className={styles.toolbar}>
          <div
            className={styles.viewToggle}
            role="group"
            aria-label="보기 전환"
          >
            <button
              type="button"
              className={`${styles.viewBtn} ${view === "grid" ? styles.viewBtnOn : ""}`}
              onClick={() => setView("grid")}
              aria-label="그리드 보기"
              aria-pressed={view === "grid"}
            >
              <GridIcon />
            </button>
            <button
              type="button"
              className={`${styles.viewBtn} ${view === "list" ? styles.viewBtnOn : ""}`}
              onClick={() => setView("list")}
              aria-label="리스트 보기"
              aria-pressed={view === "list"}
            >
              <ListIcon />
            </button>
          </div>
          <div className={styles.toolbarRight}>
            <button
              type="button"
              className={styles.sortBtn}
              onClick={() => setSortDesc((v) => !v)}
              title="정렬 전환"
            >
              {sortDesc ? "최근순" : "오래된순"} ▾
            </button>
            <button
              type="button"
              className={styles.newBtn}
              onClick={() => navigate("/")}
            >
              + 새 프로젝트
            </button>
          </div>
        </div>
      )}

      {isEmpty ? (
        <div className={styles.stateBox}>
          아직 완성작이 없어요.
          <br />
          프로젝트를 완성하면 여기에 그림이 모여요.
        </div>
      ) : errorMessage && items.length === 0 ? (
        <div className={styles.stateBox}>{errorMessage}</div>
      ) : (
        <>
          <div className={view === "list" ? styles.list : styles.grid}>
            {[...items]
              .sort((a, b) => {
                const da = Date.parse(a.completedAt || 0) || 0;
                const db = Date.parse(b.completedAt || 0) || 0;
                return sortDesc ? db - da : da - db;
              })
              .map((item) => {
                const imageId = imageIdFromUrl(item.drawingUrl);
                return (
                  <div key={item.projectId} className={styles.card}>
                    <button
                      type="button"
                      className={styles.cardThumbBtn}
                      onClick={() => navigate(`/gallery/${item.projectId}`)}
                      aria-label={`${item.projectName || "완성작"} 상세 보기`}
                    >
                      {/* 완성 그림은 /images/{id} 로 인증 서빙된다. */}
                      <AuthedImage
                        src={item.drawingUrl}
                        alt={item.projectName || "완성작"}
                        className={styles.thumb}
                      />
                    </button>
                    {/* Figma 70:28528 카드 메타: [좌 제목+날짜] [우 옵션(⋮) icon_button] */}
                    <div className={styles.cardMeta}>
                      <div className={styles.cardInfo}>
                        <span className={styles.cardTitle}>
                          {item.projectName || "완성작"}
                        </span>
                        <span className={styles.cardDate}>
                          {fmtDate(item.completedAt)}
                        </span>
                      </div>
                      <div className={styles.kebabWrap}>
                        <button
                          type="button"
                          className={styles.kebab}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(
                              menuOpenId === item.projectId
                                ? null
                                : item.projectId,
                            );
                          }}
                          aria-label="옵션"
                          aria-haspopup="menu"
                          aria-expanded={menuOpenId === item.projectId}
                        >
                          <MoreIcon />
                        </button>
                        {menuOpenId === item.projectId && (
                          <div className={styles.cardMenu} role="menu">
                            <button
                              type="button"
                              className={styles.cardMenuItem}
                              disabled={
                                imageId != null && downloadingIds.has(imageId)
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenId(null);
                                handleDownload(item.drawingUrl);
                              }}
                            >
                              다운로드
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>

          {/* 추가 페이지 로딩 표시 / 무한 스크롤 센티넬 */}
          {hasMore && <div ref={sentinelRef} className={styles.sentinel} />}
          {loading && items.length > 0 && (
            <div className={styles.loadingMore}>불러오는 중…</div>
          )}
          {errorMessage && items.length > 0 && (
            <div className={styles.loadingMore}>{errorMessage}</div>
          )}
        </>
      )}
    </div>
  );
};

const CloseIcon = () => (
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
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// 보기전환 토글 아이콘 — Figma 70:29422 grid_md / list_md (24px).
const GridIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

const ListIcon = () => (
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
    <line x1="8" y1="6" x2="20" y2="6" />
    <line x1="8" y1="12" x2="20" y2="12" />
    <line x1="8" y1="18" x2="20" y2="18" />
    <circle cx="4" cy="6" r="0.6" />
    <circle cx="4" cy="12" r="0.6" />
    <circle cx="4" cy="18" r="0.6" />
  </svg>
);

// 카드 옵션(⋮) — Figma 70:28528 icon_button(더보기·다운로드 등 옵션 메뉴 트리거).
const MoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
  </svg>
);

export default CompletedGalleryPage;
