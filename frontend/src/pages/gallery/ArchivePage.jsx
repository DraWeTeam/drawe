import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCollections, getCompletedGallery } from "./api";
import { downloadImage } from "./download";
import CollectionCard from "./CollectionCard";
import AuthedImage from "../chat/AuthedImage";
import styles from "./ArchivePage.module.css";

// SCR-ARCH-01/02 아카이브 홈 — 레퍼런스 컬렉션 요약 row + 완성작 갤러리 요약 row(각 더보기).
//   레퍼런스는 "명명된 컬렉션"(명암/손 구도 등, 태그칩) 카드 그리드. 전체는 /archive/references.
//   컬렉션·완성작 모두 비었을 때만 SCR-ARCH-01 빈 상태 일러스트를 렌더한다.
//   ★셸: 완성작 섹션의 '완성작' 의미(완성 그림 drawingUrl vs 가이딩 기록 집계)는 ③ 트랙 —
//   소스가 바뀌어도 이 홈의 섹션 구조는 유지된다(셸이 ③ 에 비종속).
const PREVIEW_COUNT = 8;
// 홈 레퍼런스 요약에 노출할 컬렉션 카드 수(전체는 더보기).
const COLLECTION_PREVIEW = 6;

const ArchivePage = () => {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [refLoading, setRefLoading] = useState(true);
  const [refError, setRefError] = useState("");
  const [completed, setCompleted] = useState([]);
  const [completedLoading, setCompletedLoading] = useState(true);
  // 다운로드 중인 imageId 집합 (버튼 중복 클릭 방지)
  const [downloadingIds, setDownloadingIds] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    const fetchAll = async () => {
      setRefLoading(true);
      setRefError("");
      setCompletedLoading(true);
      try {
        const data = await getCollections();
        if (alive) setCollections(data?.collections ?? []);
      } catch (err) {
        if (alive)
          setRefError(
            err.response?.data?.error?.message ||
              "아카이브를 불러오지 못했어요.",
          );
      } finally {
        if (alive) setRefLoading(false);
      }
      try {
        const data = await getCompletedGallery({
          page: 0,
          size: PREVIEW_COUNT,
        });
        if (alive) setCompleted(data?.items ?? []);
      } catch {
        if (alive) setCompleted([]);
      } finally {
        if (alive) setCompletedLoading(false);
      }
    };
    fetchAll();
    return () => {
      alive = false;
    };
  }, []);

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

  const collectionPreview = collections.slice(0, COLLECTION_PREVIEW);

  // SCR-ARCH-01 빈 상태 — 저장 자료(컬렉션·완성작)가 전무하고 로딩/에러가 아닐 때만.
  const isEmpty =
    !refLoading &&
    !completedLoading &&
    !refError &&
    collections.length === 0 &&
    completed.length === 0;

  if (isEmpty) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>아카이브</h1>
        </header>
        <div className={styles.emptyState}>
          <ArchiveBoxIcon />
          <p className={styles.emptyTitle}>아직 아카이브에 저장된 자료가 없어요.</p>
          <p className={styles.emptyDesc}>마음에 드는 레퍼런스를 아카이브 해보세요!</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>아카이브</h1>
      </header>

      {/* ── 레퍼런스(컬렉션) 요약 ── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionLabel}>레퍼런스</h2>
          <button
            type="button"
            className={styles.moreLink}
            onClick={() => navigate("/archive/references")}
          >
            전체보기 <ChevronRight />
          </button>
        </div>
        {refLoading ? (
          <div className={styles.stateBox}>불러오는 중…</div>
        ) : refError ? (
          <div className={styles.stateBox}>{refError}</div>
        ) : collectionPreview.length === 0 ? (
          <div className={styles.stateBox}>
            아직 저장된 레퍼런스가 없어요.
            <br />
            마음에 드는 레퍼런스를 아카이브 해보세요.
          </div>
        ) : (
          <div className={styles.collectionGrid}>
            {collectionPreview.map((c) => (
              <CollectionCard
                key={c.id}
                collection={c}
                onClick={() => navigate(`/archive/collections/${c.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      <div className={styles.divider} />

      {/* ── 완성작 갤러리 요약 (ARCH-02, 117:17563) ── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionLabel}>완성작 갤러리</h2>
          <button
            type="button"
            className={styles.moreLink}
            onClick={() => navigate("/gallery")}
          >
            전체보기 <ChevronRight />
          </button>
        </div>
        {completedLoading ? (
          <div className={styles.stateBox}>불러오는 중…</div>
        ) : completed.length === 0 ? (
          <div className={styles.stateBox}>
            아직 완성작이 없어요.
            <br />
            프로젝트를 완성하면 여기에 그림이 모여요.
          </div>
        ) : (
          <div className={styles.completedGrid}>
            {completed.map((item) => {
              const imageId = imageIdFromUrl(item.drawingUrl);
              return (
                <div key={item.projectId} className={styles.completedCard}>
                  <div className={styles.completedThumbBox}>
                    <AuthedImage
                      src={item.drawingUrl}
                      alt={item.projectName || "완성작"}
                      className={styles.completedThumb}
                    />
                    <button
                      type="button"
                      className={styles.downloadBtn}
                      onClick={() => handleDownload(imageId, item.drawingUrl)}
                      disabled={imageId != null && downloadingIds.has(imageId)}
                      aria-label="이미지 다운로드"
                      title="다운로드"
                    >
                      <DownloadIcon />
                    </button>
                  </div>
                  <div className={styles.completedMeta}>
                    <span className={styles.completedLabel}>
                      {item.projectName || "완성작"}
                    </span>
                    <span className={styles.completedDate}>
                      {formatDate(item.completedAt ?? item.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

// 완성 그림 서빙 경로 "/images/{id}" 에서 이미지 id 추출(CompletedGalleryPage 와 동일 규칙).
const imageIdFromUrl = (url) => {
  const m = /\/images\/(\d+)/.exec(url || "");
  return m ? Number(m[1]) : null;
};

// 완성 일자(있으면) 표시 — 없으면 빈 문자열(셸: 소스에 date 없어도 안전).
const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

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

// 섹션 '전체보기 >' 우측 chevron (SCR-ARCH-02).
const ChevronRight = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

// SCR-ARCH-01 빈 상태 일러스트 (아카이브 박스). 디자인 토큰 아닌 인라인 SVG 에셋.
const ArchiveBoxIcon = () => (
  <svg
    className={styles.emptyIcon}
    width="72"
    height="72"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 8v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8" />
    <rect x="1" y="3" width="22" height="5" rx="1" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

export default ArchivePage;
