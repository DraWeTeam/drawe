import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
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

// 프론트 필터 키 → GA4 이벤트 값 (스펙상 completed 는 gallery 로 집계)
const FILTER_GA = {
  all: "all",
  project: "project",
  reference: "reference",
  completed: "gallery",
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
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  const inputRef = useRef(null);

  // search_cancelled 시그널용 — 검색어 입력/결과 클릭 여부를 modal 생명주기 동안 기억
  const hadQueryRef = useRef(false);
  const hadClickRef = useRef(false);

  const trimmed = query.trim();
  const showResults = trimmed.length > 0;
  const totalCount =
    results.projects.length +
    results.references.length +
    results.completed.length;

  // 진입점: /archive·/gallery 영역에서 열면 archive, 그 외엔 프로젝트 목록
  const inArchiveArea =
    location.pathname.startsWith("/archive") ||
    location.pathname.startsWith("/gallery");
  const entryPoint = inArchiveArea ? "archive" : "project_list";
  const searchScope = inArchiveArea ? "archive" : "project";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // GA4: 검색창 진입(마운트) / 이탈·초기화(언마운트). 모든 닫기 경로를 커버.
  useEffect(() => {
    track("search_started", {
      entry_point: entryPoint,
      initial_filter: "all",
    });
    return () => {
      track("search_cancelled", {
        had_query: hadQueryRef.current,
        had_click: hadClickRef.current,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 검색어가 한 번이라도 입력되었는지 기록
  useEffect(() => {
    if (trimmed) hadQueryRef.current = true;
  }, [trimmed]);

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

  const trackResultClick = (resultType, index) => {
    hadClickRef.current = true;
    track("search_result_clicked", {
      result_type: resultType,
      result_position: index + 1, // 1부터
      query_length: trimmed.length,
      total_results: totalCount,
    });
  };

  const openProject = (p, index) => {
    trackResultClick("project", index);
    pushRecent(trimmed, "project");
    onClose();
    navigate(`/projects/${p.id}/chat`);
  };

  // 레퍼런스 결과 → 레퍼런스 아카이브로 이동
  const openReference = (index) => {
    trackResultClick("reference", index);
    pushRecent(trimmed, "reference");
    onClose();
    navigate("/archive");
  };

  // 완성작 결과 → 완성작 갤러리로 이동
  const openCompleted = (index) => {
    trackResultClick("gallery_item", index);
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
              if (e.key !== "Enter") return;
              if (trimmed) {
                track("search_query_submitted", {
                  search_scope: searchScope,
                  query_length: trimmed.length,
                  filter_type: FILTER_GA[filter] || filter,
                  result_count: totalCount,
                });
              }
              pushRecent(trimmed, filter);
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
              onClick={() => {
                if (f.key !== filter) {
                  track("search_filter_changed", {
                    previous_filter: FILTER_GA[filter] || filter,
                    new_filter: FILTER_GA[f.key] || f.key,
                    has_query: trimmed.length > 0,
                  });
                }
                setFilter(f.key);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className={styles.bodyArea}>
          {showResults ? (
            <>
              <p
                className={`${styles.sectionLabel} ${styles.sectionLabelSticky}`}
              >
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
                        {results.projects.map((p, i) => (
                          <li key={`p-${p.id}`}>
                            <button
                              type="button"
                              className={styles.row}
                              onClick={() => openProject(p, i)}
                            >
                              <span className={styles.rowIcon}>
                                <FolderIcon />
                              </span>
                              <span className={styles.rowText}>{p.name}</span>
                              <span className={styles.rowChevron}>
                                <ChevronRightIcon />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {/* 레퍼런스 */}
                  {results.references.length > 0 && (
                    <>
                      {showGroupLabels && results.projects.length > 0 && (
                        <div className={styles.divider} />
                      )}
                      {showGroupLabels && (
                        <p className={styles.groupLabel}>레퍼런스</p>
                      )}
                      <ul className={styles.list}>
                        {results.references.map((r, i) => (
                          <li key={`r-${r.imageId}-${r.projectId}`}>
                            <button
                              type="button"
                              className={styles.row}
                              onClick={() => openReference(i)}
                            >
                              <AuthedImage
                                src={r.url}
                                alt="레퍼런스"
                                className={styles.thumb}
                              />
                              <span className={styles.rowText}>
                                {r.projectName}
                              </span>
                              <span className={styles.rowChevron}>
                                <ChevronRightIcon />
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
                      {showGroupLabels &&
                        (results.projects.length > 0 ||
                          results.references.length > 0) && (
                          <div className={styles.divider} />
                        )}
                      {showGroupLabels && (
                        <p className={styles.groupLabel}>완성작 갤러리</p>
                      )}
                      <ul className={styles.list}>
                        {results.completed.map((c, i) => (
                          <li key={`c-${c.projectId}`}>
                            <button
                              type="button"
                              className={styles.row}
                              onClick={() => openCompleted(i)}
                            >
                              <AuthedImage
                                src={c.drawingUrl}
                                alt="완성작"
                                className={styles.thumb}
                              />
                              <span className={styles.rowText}>
                                {c.projectName}
                              </span>
                              <span className={styles.rowChevron}>
                                <ChevronRightIcon />
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

const ChevronRightIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M9 6L15 12L9 18"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ArchiveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 7h16l-1.2 11.2A2 2 0 0 1 16.8 20H7.2a2 2 0 0 1-2-1.8L4 7Zm1-3h14a1 1 0 0 1 1 1v1H4V5a1 1 0 0 1 1-1Zm5 8a1 1 0 0 0 0 2h4a1 1 0 0 0 0-2h-4Z" />
  </svg>
);

export default SearchModal;
