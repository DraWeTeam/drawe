import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { globalSearch } from "../pages/search/api";
import AuthedImage from "../pages/chat/AuthedImage";
import { track } from "../analytics";
import styles from "./SearchModal.module.css";

const RECENT_KEY = "drawe_recent_searches";
const RECENT_MAX = 3;

// 검색 대상: 전체 / 프로젝트 / 레퍼런스(아카이브) / 완성작 갤러리. SCRUM-105.
const FILTERS = [
  { key: "all", label: "전체" },
  { key: "project", label: "프로젝트" },
  { key: "reference", label: "레퍼런스" },
  { key: "completed", label: "완성작 갤러리" },
];

// 프론트 필터 키 → 백엔드 scope
const SCOPE_BY_FILTER = {
  all: "ALL",
  project: "PROJECT",
  reference: "REFERENCE",
  completed: "COMPLETED",
};

const EMPTY_RESULTS = { projects: [], references: [], completed: [] };

// 최근 검색어 = { term, type } (type: 검색 당시 대상 — 아이콘 결정용)
function loadRecent() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => {
        if (typeof x === "string") return { term: x, type: "project" };
        if (x && typeof x.term === "string")
          return { term: x.term, type: x.type || "project" };
        return null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const SearchModal = ({ onClose }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  const inputRef = useRef(null);

  const trimmed = query.trim();
  const showResults = trimmed.length > 0;
  const totalCount =
    results.projects.length +
    results.references.length +
    results.completed.length;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ESC로 닫기
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 디바운스 검색 (대상 = filter). filter 가 바뀌어도 재검색.
  useEffect(() => {
    if (!trimmed) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await globalSearch({
          q: trimmed,
          scope: SCOPE_BY_FILTER[filter] || "ALL",
        });
        setResults({
          projects: data?.projects ?? [],
          references: data?.references ?? [],
          completed: data?.completed ?? [],
        });
      } catch {
        setResults(EMPTY_RESULTS);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [trimmed, filter]);

  // 최근 검색어 저장 — 엔터 또는 결과 클릭 시 (type은 검색 대상)
  const pushRecent = useCallback((term, type = "project") => {
    const t = (term || "").trim();
    if (!t) return;
    setRecent((prev) => {
      const next = [
        { term: t, type },
        ...prev.filter((r) => r.term !== t),
      ].slice(0, RECENT_MAX);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const removeRecent = useCallback((term) => {
    setRecent((prev) => {
      const next = prev.filter((r) => r.term !== term);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const openProject = (p) => {
    track("project_search_result_clicked", {
      project_id: p.id,
      query: trimmed,
    });
    pushRecent(trimmed, "project");
    onClose();
    navigate(`/projects/${p.id}/chat`);
  };

  // 레퍼런스 결과 → 레퍼런스 아카이브로 이동
  const openReference = () => {
    pushRecent(trimmed, "reference");
    onClose();
    navigate("/archive");
  };

  // 완성작 결과 → 완성작 갤러리로 이동
  const openCompleted = () => {
    pushRecent(trimmed, "completed");
    onClose();
    navigate("/gallery");
  };

  const goCreate = () => {
    onClose();
    navigate("/projects", { state: { openCreate: true } });
  };

  // scope=all 이고 결과 그룹이 2개 이상일 때만 그룹 소제목을 보인다(단일 그룹이면 평평하게).
  const groupsWithHits = [
    results.projects.length > 0,
    results.references.length > 0,
    results.completed.length > 0,
  ].filter(Boolean).length;
  const showGroupLabels = filter === "all" && groupsWithHits > 1;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="검색"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 검색 입력 */}
        <div className={styles.searchRow}>
          <span className={styles.searchIcon}>
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="검색어를 입력해주세요."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") pushRecent(trimmed, filter);
            }}
          />
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="닫기"
          >
            <CloseIcon />
          </button>
        </div>

        {/* 필터 */}
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`${styles.chip} ${
                filter === f.key ? styles.chipActive : ""
              }`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className={styles.bodyArea}>
          {showResults ? (
            <>
              <p className={styles.sectionLabel}>
                {loading ? "검색 중..." : `검색 결과 ${totalCount}개`}
              </p>
              {!loading && totalCount === 0 ? (
                <p className={styles.empty}>검색 결과가 없어요.</p>
              ) : (
                <>
                  {/* 프로젝트 */}
                  {results.projects.length > 0 && (
                    <>
                      {showGroupLabels && (
                        <p className={styles.groupLabel}>프로젝트</p>
                      )}
                      <ul className={styles.list}>
                        {results.projects.map((p) => (
                          <li key={`p-${p.id}`}>
                            <button
                              type="button"
                              className={styles.row}
                              onClick={() => openProject(p)}
                            >
                              <span className={styles.rowIcon}>
                                <FolderIcon />
                              </span>
                              <span className={styles.rowText}>{p.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {/* 레퍼런스 */}
                  {results.references.length > 0 && (
                    <>
                      {showGroupLabels && (
                        <p className={styles.groupLabel}>레퍼런스</p>
                      )}
                      <ul className={styles.list}>
                        {results.references.map((r) => (
                          <li key={`r-${r.imageId}-${r.projectId}`}>
                            <button
                              type="button"
                              className={styles.row}
                              onClick={openReference}
                            >
                              <AuthedImage
                                src={r.url}
                                alt="레퍼런스"
                                className={styles.thumb}
                              />
                              <span className={styles.rowText}>
                                {r.projectName}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {/* 완성작 갤러리 */}
                  {results.completed.length > 0 && (
                    <>
                      {showGroupLabels && (
                        <p className={styles.groupLabel}>완성작 갤러리</p>
                      )}
                      <ul className={styles.list}>
                        {results.completed.map((c) => (
                          <li key={`c-${c.projectId}`}>
                            <button
                              type="button"
                              className={styles.row}
                              onClick={openCompleted}
                            >
                              <AuthedImage
                                src={c.drawingUrl}
                                alt="완성작"
                                className={styles.thumb}
                              />
                              <span className={styles.rowText}>
                                {c.projectName}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <p className={styles.sectionLabel}>퀵 액션</p>
              <ul className={styles.list}>
                <li>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={goCreate}
                  >
                    <span className={styles.rowIcon}>
                      <FolderIcon />
                    </span>
                    <span className={styles.rowText}>새 프로젝트 만들기</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => {
                      onClose();
                      navigate("/archive");
                    }}
                  >
                    <span
                      className={`${styles.rowIcon} ${styles.rowIconArchive}`}
                    >
                      <ArchiveIcon />
                    </span>
                    <span className={styles.rowText}>아카이브 바로가기</span>
                  </button>
                </li>
              </ul>

              {recent.length > 0 && (
                <>
                  <div className={styles.divider} />
                  <p
                    className={`${styles.sectionLabel} ${styles.sectionLabelTight}`}
                  >
                    최근 검색어
                  </p>
                  <ul className={styles.list}>
                    {recent.map((item) => (
                      <li key={item.term}>
                        <button
                          type="button"
                          className={styles.row}
                          onClick={() => {
                            setQuery(item.term);
                            inputRef.current?.focus();
                          }}
                        >
                          <span className={styles.rowIcon}>
                            {item.type === "reference" ||
                            item.type === "completed" ? (
                              <ArchiveIcon />
                            ) : (
                              <FolderIcon />
                            )}
                          </span>
                          <span className={styles.rowText}>{item.term}</span>
                          <span
                            className={styles.rowRemove}
                            role="button"
                            tabIndex={-1}
                            aria-label="검색어 삭제"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRecent(item.term);
                            }}
                          >
                            <CloseIcon />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

/* ===== 아이콘 ===== */
const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
    <path
      d="M20 20L17 17"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path
      d="M6 6L18 18M18 6L6 18"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const FolderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
  </svg>
);

const ArchiveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 7h16l-1.2 11.2A2 2 0 0 1 16.8 20H7.2a2 2 0 0 1-2-1.8L4 7Zm1-3h14a1 1 0 0 1 1 1v1H4V5a1 1 0 0 1 1-1Zm5 8a1 1 0 0 0 0 2h4a1 1 0 0 0 0-2h-4Z" />
  </svg>
);

export default SearchModal;
