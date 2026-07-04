import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getReferenceArchive } from "./api";
import { downloadImage } from "./download";
import AuthedImage from "../chat/AuthedImage";
import styles from "./ArchivePage.module.css";

// SCR-ARCH-04 레퍼런스 전체 — 프로젝트별 저장 레퍼런스 리스트.
//   IA 재배치 전 ArchivePage 의 레퍼런스 리스트를 그대로 이 라우트(/archive/references)로 이동한 것.
//   내용·구조·스타일 무변(이동만). 아카이브 홈(/archive)의 '레퍼런스 더보기' 목적지.
const ReferenceListPage = () => {
  const navigate = useNavigate();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [downloadingIds, setDownloadingIds] = useState(() => new Set());

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
        <h1 className={styles.title}>레퍼런스</h1>
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
    </div>
  );
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

export default ReferenceListPage;
