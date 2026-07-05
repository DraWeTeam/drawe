import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCompletedGallery } from "./api";
import { downloadImage } from "./download";
import AuthedImage from "../chat/AuthedImage";
import styles from "./CompletedGalleryPage.module.css";

const PAGE_SIZE = 20;

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
        <h1 className={styles.title}>완성작 갤러리</h1>
        {initialized && !errorMessage && items.length > 0 && (
          <span className={styles.subtitle}>총 {total}개의 완성작</span>
        )}
      </header>

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
          <div className={styles.grid}>
            {items.map((item) => {
              const imageId = imageIdFromUrl(item.drawingUrl);
              return (
                <button
                  key={item.projectId}
                  type="button"
                  className={styles.card}
                  onClick={() => navigate(`/gallery/${item.projectId}`)}
                  aria-label={`${item.projectName || "완성작"} 상세 보기`}
                >
                  {/* 완성 그림은 /images/{id} 로 인증 서빙된다. */}
                  <AuthedImage
                    src={item.drawingUrl}
                    alt={item.projectName || "완성작"}
                    className={styles.thumb}
                  />
                  <span className={styles.caption}>{item.projectName}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className={styles.downloadBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(item.drawingUrl);
                    }}
                    aria-disabled={
                      imageId != null && downloadingIds.has(imageId)
                    }
                    aria-label="이미지 다운로드"
                    title="다운로드"
                  >
                    <DownloadIcon />
                  </span>
                </button>
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

export default CompletedGalleryPage;
