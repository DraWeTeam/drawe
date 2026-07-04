import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getReferenceArchive, getCompletedGallery } from "./api";
import { downloadImage } from "./download";
import AuthedImage from "../chat/AuthedImage";
import styles from "./ArchivePage.module.css";

const ArchivePage = () => {
  const navigate = useNavigate();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  // 다운로드 중인 imageId 집합 (버튼 중복 클릭 방지)
  const [downloadingIds, setDownloadingIds] = useState(() => new Set());
  // ARCH-02 완성작 갤러리 섹션(프리뷰). 데이터는 /gallery 와 동일 소스(getCompletedGallery).
  //   ★셸: UI 구조·빈 상태만. '완성작' 의미(완성 그림 drawingUrl vs 가이딩 기록 집계)는 ③ 트랙 —
  //   여기선 미결정. ③ 에서 소스가 바뀌어도 이 섹션 구조는 유지된다(셸이 ③ 에 비종속).
  const [completed, setCompleted] = useState([]);
  const [completedLoading, setCompletedLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const fetchCompleted = async () => {
      setCompletedLoading(true);
      try {
        const data = await getCompletedGallery({ page: 0, size: 8 }); // 프리뷰 한 줄
        if (alive) setCompleted(data?.items ?? []);
      } catch {
        if (alive) setCompleted([]);
      } finally {
        if (alive) setCompletedLoading(false);
      }
    };
    fetchCompleted();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const fetchArchive = async () => {
      setLoading(true);
      setErrorMessage("");
      try {
        const data = await getReferenceArchive();
        if (alive) setSections(data?.sections ?? []);
      } catch (err) {
        if (alive) {
          setErrorMessage(
            err.response?.data?.error?.message ||
              "아카이브를 불러오지 못했어요.",
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchArchive();
    return () => {
      alive = false;
    };
  }, []);

  const handleDownload = async (imageId, url) => {
    if (downloadingIds.has(imageId)) return;
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

  const totalRefs = sections.reduce(
    (sum, s) => sum + (s.references?.length ?? 0),
    0,
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>레퍼런스 아카이브</h1>
        {!loading && !errorMessage && (
          <span className={styles.subtitle}>
            총 {totalRefs}개의 레퍼런스 · {sections.length}개 프로젝트
          </span>
        )}
      </header>

      {loading ? (
        <div className={styles.stateBox}>불러오는 중…</div>
      ) : errorMessage ? (
        <div className={styles.stateBox}>{errorMessage}</div>
      ) : sections.length === 0 ? (
        <div className={styles.stateBox}>
          아직 저장된 레퍼런스가 없어요.
          <br />
          프로젝트에서 마음에 드는 레퍼런스를 담아보세요.
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.projectId} className={styles.section}>
            <div className={styles.sectionHead}>
              <button
                type="button"
                className={styles.sectionTitle}
                onClick={() => navigate(`/projects/${section.projectId}/chat`)}
                title="프로젝트로 이동"
              >
                {section.projectName}
              </button>
              <span className={styles.sectionCount}>
                {section.references?.length ?? 0}
              </span>
            </div>

            <div className={styles.grid}>
              {(section.references ?? []).map((ref) => (
                <div key={ref.imageId} className={styles.card}>
                  <AuthedImage
                    src={ref.url}
                    alt="레퍼런스"
                    className={styles.thumb}
                  />
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
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {/* ARCH-02(117:17540) 완성작 갤러리 섹션 — 레퍼런스 섹션 아래(divider 로 구분).
          카드는 레퍼런스와 다름: 썸네일 + Label + Date(badge 없음). 데이터/의미는 ③ 트랙. */}
      <div className={styles.divider} />
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionLabel}>완성작 갤러리</h2>
          <button
            type="button"
            className={styles.moreLink}
            onClick={() => navigate("/gallery")}
          >
            더보기
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

export default ArchivePage;
