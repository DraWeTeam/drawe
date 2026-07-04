import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Tooltip from "../../components/Tooltip";
import TutorialCoachmark from "../chat/TutorialCoachmark";
import { unsplashSized } from "../chat/imageUtils";
import { addReference, addPin, getPins, removePin } from "../projects/api";
import { getReferenceArchive } from "../gallery/api";
import { notifyArchiveChanged } from "../gallery/archiveEvents";
import { track } from "../../analytics";
import {
  ackGenerationSuggestion,
  clearReaction,
  dislikeImage,
  likeImage,
  searchReferenceBoard,
} from "./referenceBoardApi";
import GenerationSuggestModal from "./GenerationSuggestModal";
import styles from "./ReferenceBoard.module.css";

// 필터 칩 → source 파라미터. 일러스트는 현재 시스템에 사진/일러스트 구분이 없어 보류(disabled).
const CHIPS = [
  { key: "ALL", label: "전체" },
  { key: "AI", label: "AI" },
  { key: "ARCHIVE", label: "아카이브" },
  { key: "PHOTO", label: "사진" },
  { key: "ILLUST", label: "일러스트", disabled: true },
];

// 반응 튜토리얼 — 새 프로젝트 생성 시 ProjectList 가 세팅하는 플래그(프로젝트 id).
//   가이드(첫 진입) 튜토리얼이 닫힌 뒤에 노출.
const REACTION_TUT_FLAG = "drawe_show_reaction_tutorial";
const PROJECT_TUT_FLAG = "drawe_show_project_tutorial";

// 아이템을 N개 컬럼에 라운드로빈 분배(마소너리). 원본 ReferenceGrid 방식과 동일.
function splitIntoColumns(items, columnCount) {
  const columns = Array.from({ length: columnCount }, () => []);
  items.forEach((item, idx) => columns[idx % columnCount].push(item));
  return columns;
}

/**
 * 키워드 검색 레퍼런스 보드(좌측 패널).
 *   진입 → 빈 상태. 검색 → GET /reference-board/search.
 *   카드 반응(좋아요/싫어요/고정/아카이브)은 POST. 싫어요 3회 → 생성 유도 모달.
 *
 * @param {number|string} projectId
 * @param {() => void} [onRequestGenerate] - 생성 유도 모달의 "생성하러 가기" 클릭 시 호출(우측 패널 레퍼런스 생성 모드로).
 * @param {boolean} [expanded] - 보드 전체보기 여부(컬럼 수: 전체보기 3, 분할 2).
 */
const ReferenceBoard = ({ projectId, onRequestGenerate, expanded }) => {
  const navigate = useNavigate();

  const [query, setQuery] = useState(""); // 입력창 값
  const [submittedQuery, setSubmittedQuery] = useState(""); // 마지막으로 실제 검색한 키워드
  const [source, setSource] = useState("ALL");
  // 코퍼스 검색은 AI+사진을 섞어서 반환한다(서버 소스필터 없음).
  //   칩(전체/AI/사진)은 코퍼스 결과를 클라에서 image.source 로 필터만 → 재검색 안 함(churn 제거).
  //   아카이브만 별도 데이터라 source=ARCHIVE 로 조회.
  const [corpusItems, setCorpusItems] = useState([]); // [{ image, myReaction }]
  const [archiveItems, setArchiveItems] = useState([]);
  const corpusQueryRef = useRef(null); // corpusItems 가 대응하는 검색어
  const archiveQueryRef = useRef(null); // archiveItems 가 대응하는 검색어
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [pinnedRefs, setPinnedRefs] = useState([]);
  const [archivedIds, setArchivedIds] = useState(() => new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [showReactionTut, setShowReactionTut] = useState(false);

  const firstMenuRef = useRef(null);

  const pinnedIds = useMemo(
    () => new Set(pinnedRefs.map((r) => r.id)),
    [pinnedRefs],
  );

  const refreshPins = useCallback(async () => {
    try {
      const data = await getPins(projectId);
      setPinnedRefs(data?.pins ?? []);
    } catch (err) {
      console.error("핀 조회 실패", err);
    }
  }, [projectId]);

  // 진입 시 핀 + 아카이브 상태 로드(화면 연동: 진입 시 보드 상태 조회).
  useEffect(() => {
    if (!projectId) return;
    refreshPins();
  }, [projectId, refreshPins]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    (async () => {
      try {
        const data = await getReferenceArchive();
        if (!alive) return;
        const section = (data?.sections ?? []).find(
          (s) => String(s.projectId) === String(projectId),
        );
        setArchivedIds(
          new Set((section?.references ?? []).map((r) => r.imageId)),
        );
      } catch {
        // 상태표시는 부가 정보 — 실패해도 무시
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 실제 검색 호출. domain: "CORPUS"(source=ALL) | "ARCHIVE"(source=ARCHIVE).
  const fetchSet = useCallback(
    async (keyword, domain) => {
      setLoading(true);
      setError("");
      try {
        const data = await searchReferenceBoard(projectId, {
          q: keyword,
          source: domain === "ARCHIVE" ? "ARCHIVE" : "ALL",
          // topK 미전송 → 백엔드 기본값(10) 사용
        });
        const results = data?.results ?? [];
        if (domain === "ARCHIVE") {
          setArchiveItems(results);
          archiveQueryRef.current = keyword;
        } else {
          setCorpusItems(results);
          corpusQueryRef.current = keyword;
        }
        track("reference_board_searched", {
          project_id: projectId,
          query_length: keyword.length,
          domain,
          result_count: results.length,
        });
      } catch (err) {
        setError(
          err.response?.data?.error?.message ||
            "검색에 실패했어요. 잠시 후 다시 시도해주세요.",
        );
        if (domain === "ARCHIVE") setArchiveItems([]);
        else setCorpusItems([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  // 검색은 키워드 제출 때만. 현재 칩이 아카이브면 아카이브를, 아니면 코퍼스를 조회.
  const handleSubmit = (e) => {
    e?.preventDefault?.();
    const keyword = query.trim();
    setSubmittedQuery(keyword);
    if (!keyword) {
      setCorpusItems([]);
      setArchiveItems([]);
      corpusQueryRef.current = null;
      archiveQueryRef.current = null;
      return;
    }
    fetchSet(keyword, source === "ARCHIVE" ? "ARCHIVE" : "CORPUS");
  };

  // 칩 클릭 — 전체/AI/사진은 코퍼스 결과를 클라 필터(재검색 안 함).
  //   아카이브는 별도 데이터라 필요 시(같은 키워드로 아직 없으면) 조회.
  //   아카이브 → 코퍼스로 돌아올 때 코퍼스가 이 키워드로 없으면(직전이 아카이브였음) 조회.
  const handleChip = (key, disabled) => {
    if (disabled || key === source) return;
    setSource(key);
    const keyword = submittedQuery;
    if (!keyword) return; // 검색 전이면 데이터 없음
    if (key === "ARCHIVE") {
      if (archiveQueryRef.current !== keyword) fetchSet(keyword, "ARCHIVE");
    } else if (corpusQueryRef.current !== keyword) {
      fetchSet(keyword, "CORPUS");
    }
  };

  // 검색 결과 없음 화면의 X → 처음 상태로(검색어·결과 비우고 핀만 보이게).
  const resetSearch = () => {
    setQuery("");
    setSubmittedQuery("");
    setSource("ALL");
    setCorpusItems([]);
    setArchiveItems([]);
    corpusQueryRef.current = null;
    archiveQueryRef.current = null;
  };

  // 결과가 처음 뜨면 반응 튜토리얼 노출(새 프로젝트 + 가이드 튜토리얼 닫힌 뒤).
  useEffect(() => {
    const hasResults = corpusItems.length > 0 || archiveItems.length > 0;
    const flagged =
      localStorage.getItem(REACTION_TUT_FLAG) === String(projectId);
    const guidePending =
      localStorage.getItem(PROJECT_TUT_FLAG) === String(projectId);
    if (hasResults && flagged && !guidePending) setShowReactionTut(true);
  }, [corpusItems, archiveItems, projectId]);

  const dismissReactionTut = () => {
    localStorage.removeItem(REACTION_TUT_FLAG);
    setShowReactionTut(false);
  };

  // 반응 상태를 코퍼스·아카이브 두 결과셋 모두에 반영(같은 이미지가 양쪽에 있을 수 있음).
  const patchReaction = useCallback((imageId, reaction) => {
    const patch = (arr) =>
      arr.map((it) =>
        it.image.id === imageId ? { ...it, myReaction: reaction } : it,
      );
    setCorpusItems((prev) => patch(prev));
    setArchiveItems((prev) => patch(prev));
  }, []);

  const findItem = useCallback(
    (imageId) =>
      corpusItems.find((it) => it.image.id === imageId) ||
      archiveItems.find((it) => it.image.id === imageId),
    [corpusItems, archiveItems],
  );

  // 좋아요 토글 — 같은 반응 재클릭이면 취소. 좋아요한 카드는 상단으로 재정렬(클라이언트).
  const handleLike = async (imageId) => {
    const item = findItem(imageId);
    if (!item) return;
    const prev = item.myReaction;
    const next = prev === "LIKE" ? null : "LIKE";
    patchReaction(imageId, next); // 낙관적 업데이트
    try {
      if (next === null) await clearReaction(projectId, imageId);
      else await likeImage(projectId, imageId);
      track("reference_board_reaction", {
        project_id: projectId,
        reference_id: imageId,
        reaction: next === null ? "none" : "like",
      });
    } catch (err) {
      patchReaction(imageId, prev); // 롤백
      console.error("좋아요 실패", err);
    }
  };

  // 싫어요 토글 — 즉시 제거하지 않고 "정렬상 맨 아래"로 내린다(백엔드가 다음 검색부터 제외).
  //   같은 반응 재클릭이면 취소. 응답 suggestGeneration:true(세션 싫어요 3회) 면 생성 유도 모달.
  const handleDislike = async (imageId) => {
    const item = findItem(imageId);
    if (!item) return;
    const prev = item.myReaction;
    const next = prev === "DISLIKE" ? null : "DISLIKE";
    patchReaction(imageId, next); // 낙관적 업데이트
    try {
      if (next === null) {
        await clearReaction(projectId, imageId);
      } else {
        const res = await dislikeImage(projectId, imageId);
        track("reference_board_reaction", {
          project_id: projectId,
          reference_id: imageId,
          reaction: "dislike",
          dislike_count: res?.dislikeCount ?? null,
        });
        if (res?.suggestGeneration) setSuggestOpen(true);
      }
    } catch (err) {
      patchReaction(imageId, prev); // 롤백
      console.error("싫어요 실패", err);
    }
  };

  const handlePinToggle = async (imageId) => {
    const wasPinned = pinnedIds.has(imageId);
    const snapshot = [...pinnedRefs];
    const image =
      pinnedRefs.find((r) => r.id === imageId) || findItem(imageId)?.image;

    // 낙관적 업데이트
    if (wasPinned) {
      setPinnedRefs((prev) => prev.filter((r) => r.id !== imageId));
    } else if (image) {
      setPinnedRefs((prev) => [...prev, image]);
    }
    try {
      if (wasPinned) await removePin(projectId, imageId);
      else await addPin(projectId, imageId);
      await refreshPins();
    } catch (err) {
      setPinnedRefs(snapshot);
      if (err.response?.status === 409) {
        setError("(3/3) 핀 슬롯이 가득 찼어요. 다른 핀을 먼저 풀어주세요.");
      } else {
        setError(err.response?.data?.error?.message || "핀 처리에 실패했어요.");
      }
    }
  };

  const handleArchive = async (imageId) => {
    try {
      await addReference(projectId, imageId);
      setArchivedIds((prev) => new Set(prev).add(imageId));
      notifyArchiveChanged();
      track("reference_archived", {
        project_id: projectId,
        reference_id: imageId,
      });
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          "아카이브 저장에 실패했어요. 다시 시도해주세요.",
      );
    }
  };

  const handleCardClick = (image) => {
    track("reference_board_reference_viewed", {
      project_id: projectId,
      reference_id: image.id,
    });
    // 레퍼런스 클릭 → 상세(아카이브 상세 화면 재활용).
    navigate(`/projects/${projectId}/reference/${image.id}`, {
      state: { reference: image },
    });
  };

  // 모달을 닫을 때(둘 중 무엇이든) 세션 싫어요 카운터를 리셋한다(best-effort).
  const ackSuggestion = () => {
    ackGenerationSuggestion(projectId).catch(() => {});
  };

  const handleLaterFromModal = () => {
    setSuggestOpen(false);
    ackSuggestion();
  };

  const handleGenerateFromModal = () => {
    setSuggestOpen(false);
    ackSuggestion();
    onRequestGenerate?.();
  };

  // 표시 대상 결과셋 + 클라이언트 카테고리 필터 + 반응 정렬.
  //   아카이브 칩은 archiveItems, 그 외는 corpusItems 를 image.source 로 필터(재검색 없음).
  //   좋아요=위, 중립=중간, 싫어요=아래(안정 정렬로 그룹 내 순서 보존). 번호는 정렬 후 1..N.
  const displayItems = useMemo(() => {
    const base = source === "ARCHIVE" ? archiveItems : corpusItems;
    const filtered =
      source === "AI"
        ? base.filter((it) => it.image.source === "AI")
        : source === "PHOTO"
          ? base.filter((it) => !!it.image.source && it.image.source !== "AI")
          : base; // ALL, ARCHIVE
    const rank = (r) => (r === "LIKE" ? 0 : r === "DISLIKE" ? 2 : 1);
    return [...filtered].sort(
      (a, b) => rank(a.myReaction) - rank(b.myReaction),
    );
  }, [corpusItems, archiveItems, source]);

  // 고정(핀)도 현재 필터 카테고리에 맞는 것만 노출.
  //   전체=모두 / AI=생성이미지 / 사진=Unsplash 등 비AI / 아카이브=아카이브에 저장된 핀.
  const visiblePins = useMemo(() => {
    if (source === "ALL") return pinnedRefs;
    return pinnedRefs.filter((image) => {
      if (source === "AI") return image.source === "AI";
      if (source === "PHOTO") return !!image.source && image.source !== "AI";
      if (source === "ARCHIVE") return archivedIds.has(image.id);
      return true;
    });
  }, [pinnedRefs, source, archivedIds]);

  // 결과존은 핀을 제외한 검색결과 기준(핀은 별도 존에서 항상 렌더 → 검색과 무관).
  const resultItems = useMemo(
    () => displayItems.filter((it) => !pinnedIds.has(it.image.id)),
    [displayItems, pinnedIds],
  );

  // 빈상태 3분기:
  //   noSearchResults — 검색 자체가 결과 0(핀 숨기고 생성 CTA + X)
  //   categoryEmpty   — 검색은 됐지만 이 카테고리 필터에만 결과 없음(기존 안내, 생성 문구 X)
  //   초기            — 검색 전(핀 없으면 빈 보드 안내)
  //   생성 CTA(noSearchResults)는 코퍼스 계열(전체/AI/사진)에서 전체 검색이 아무것도
  //   못 냈을 때만. 아카이브는 '생성'으로 채워지는 데이터가 아니므로, 비면 항상
  //   categoryEmpty(다른 카테고리 안내)로 처리한다.
  const searched = submittedQuery !== "";
  const overallHasResults = corpusItems.length > 0 || archiveItems.length > 0;
  const viewEmpty = !loading && searched && resultItems.length === 0;
  const noSearchResults =
    viewEmpty && source !== "ARCHIVE" && !overallHasResults;
  const categoryEmpty = viewEmpty && !noSearchResults;

  // 핀 + 검색결과를 한 마소너리 그리드에(가로만 맞추고 비율 유지). 전체보기 3 / 분할 2컬럼.
  //   핀은 앞에("고정" 뱃지), 결과는 1..N. 핀된 이미지는 결과에서 이미 제외됨.
  const columnCount = expanded ? 3 : 2;
  const hasCards = visiblePins.length > 0 || resultItems.length > 0;
  const columns = useMemo(() => {
    const pinItems = visiblePins.map((image) => ({
      key: `pin-${image.id}`,
      image,
      badge: "고정",
      myReaction: null,
      isPinnedCard: true,
    }));
    const refItems = resultItems.map(({ image, myReaction }, idx) => ({
      key: image.id,
      image,
      badge: String(idx + 1),
      myReaction,
      isPinnedCard: false,
      isFirst: idx === 0,
    }));
    return splitIntoColumns([...pinItems, ...refItems], columnCount);
  }, [visiblePins, resultItems, columnCount]);

  const renderColumns = (cols) => (
    <div className={styles.grid}>
      {cols.map((col, ci) => (
        <div key={ci} className={styles.column}>
          {col.map((it) => (
            <BoardCard
              key={it.key}
              image={it.image}
              badge={it.badge}
              myReaction={it.myReaction}
              isPinned={it.isPinnedCard || pinnedIds.has(it.image.id)}
              isArchived={archivedIds.has(it.image.id)}
              onClick={() => handleCardClick(it.image)}
              onLike={() => handleLike(it.image.id)}
              onDislike={() => handleDislike(it.image.id)}
              onPinToggle={() => handlePinToggle(it.image.id)}
              onArchive={() => handleArchive(it.image.id)}
              menuBtnRef={it.isFirst ? firstMenuRef : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.wrapper}>
      {/* 검색바 */}
      <form className={styles.searchForm} onSubmit={handleSubmit}>
        <div className={styles.searchBox}>
          <SearchIcon />
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예) 창가, 카페, 여성"
            aria-label="레퍼런스 키워드 검색"
          />
          {query && (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={resetSearch}
              aria-label="검색어 지우기"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </form>

      {/* 필터 칩 */}
      <div className={styles.chips}>
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`${styles.chip} ${
              source === c.key ? styles.chipActive : ""
            }`}
            onClick={() => handleChip(c.key, c.disabled)}
            disabled={c.disabled}
            title={c.disabled ? "준비 중" : undefined}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <span>⚠️ {error}</span>
          <button
            type="button"
            className={styles.errorClose}
            onClick={() => setError("")}
            aria-label="닫기"
          >
            ×
          </button>
        </div>
      )}

      {/* 콘텐츠 */}
      <div className={styles.content}>
        {loading ? (
          <div className={styles.stateBox}>
            <p className={styles.stateHint}>레퍼런스를 찾고 있어요…</p>
          </div>
        ) : noSearchResults ? (
          // 검색 자체가 결과 0 — 핀도 숨기고 안내만. (초기화는 입력창 X)
          <div className={styles.stateBox}>
            <EmptyIcon />
            <p className={styles.stateTitle}>검색 결과가 없습니다</p>
            <p className={styles.stateHint}>
              원하는 레퍼런스가 없다면 직접 생성해보세요.
            </p>
            <button
              type="button"
              className={styles.generateCta}
              onClick={() => onRequestGenerate?.()}
            >
              레퍼런스 생성하러 가기
            </button>
          </div>
        ) : categoryEmpty ? (
          // 이 카테고리에 매칭 결과 없음 — 핀도 숨기고 안내만(핀은 검색 매칭이 아니므로).
          <div className={styles.stateBox}>
            <EmptyIcon />
            <p className={styles.stateTitle}>검색 결과가 없어요</p>
            <p className={styles.stateHint}>다른 카테고리를 선택해보세요.</p>
          </div>
        ) : hasCards ? (
          // 핀 + 검색결과 그리드
          renderColumns(columns)
        ) : (
          // 초기(검색 전 + 핀 없음) — 빈 보드 안내
          <div className={styles.stateBox}>
            <EmptyIcon />
            <p className={styles.stateTitle}>레퍼런스 보드가 비어있어요</p>
            <p className={styles.stateHint}>
              검색창에 키워드를 입력하여 원하는 레퍼런스를 찾아보세요.
            </p>
          </div>
        )}
      </div>

      {/* 반응 튜토리얼 — 첫 카드 ⋮ 메뉴 오른쪽 */}
      {showReactionTut && resultItems.length > 0 && (
        <TutorialCoachmark
          anchorRef={firstMenuRef}
          onClose={dismissReactionTut}
          placement="right"
          variant="reaction"
          gap={8}
          step="1 of 1"
          title="반응할수록 더 정확해져요"
          description="고정하기, 마음에 들어요, 별로예요 등의 반응을 통해 학습하고 더 정확한 레퍼런스를 제공할 수 있어요."
        />
      )}

      {/* 생성 유도 모달 — 싫어요 3회 도달 */}
      {suggestOpen && (
        <GenerationSuggestModal
          onLater={handleLaterFromModal}
          onGenerate={handleGenerateFromModal}
        />
      )}
    </div>
  );
};

/* ===== 카드 ===== */
const BoardCard = ({
  image,
  badge,
  myReaction,
  isPinned,
  isArchived,
  onClick,
  onLike,
  onDislike,
  onPinToggle,
  onArchive,
  menuBtnRef,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const isAi = image.source === "AI";
  const label =
    image.photographerName ||
    image.subject ||
    (isAi ? "AI 생성 이미지" : "레퍼런스");

  const runAndClose = (fn) => (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    fn();
  };

  return (
    <div
      className={`${styles.card} ${menuOpen ? styles.cardActive : ""} ${
        myReaction === "DISLIKE" ? styles.cardDisliked : ""
      }`}
      onClick={onClick}
    >
      <div className={styles.cardImage}>
        {imgFailed ? (
          <div className={styles.imageFallback} aria-hidden>
            <BrokenImageIcon />
          </div>
        ) : (
          <img
            src={unsplashSized(image.url, 400)}
            alt={label}
            className={styles.image}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        )}
        {isAi && <span className={styles.aiBadge}>AI</span>}
        {/* 핀 버튼 — 기본 숨김, 카드 호버 시 노출. 핀된 카드는 항상 표시(클릭 시 해제). */}
        <button
          type="button"
          className={`${styles.pinBtn} ${isPinned ? styles.pinBtnActive : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onPinToggle();
          }}
          aria-label={isPinned ? "핀 해제" : "핀하기"}
          title={isPinned ? "핀 해제" : "핀하기"}
        >
          <PinIcon />
        </button>
      </div>

      <div className={styles.cardFooter}>
        <span className={styles.cardLabel}>
          <span
            className={`${styles.indexBadge} ${
              isPinned && badge === "고정" ? styles.pinBadge : ""
            }`}
          >
            {badge}
          </span>
          <span className={styles.labelText}>{label}</span>
        </span>
        <div
          className={styles.menuWrap}
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip label="옵션 보기" placement="bottom">
            <button
              type="button"
              className={styles.menuBtn}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
              aria-label="옵션 보기"
              ref={menuBtnRef}
            >
              <DotsIcon />
            </button>
          </Tooltip>
          {menuOpen && (
            <div className={styles.menuPopup}>
              <button
                type="button"
                className={`${styles.menuItem} ${
                  isPinned ? styles.menuItemActive : ""
                }`}
                onClick={runAndClose(onPinToggle)}
              >
                <PinIcon />
                <span>{isPinned ? "고정 취소하기" : "고정하기"}</span>
              </button>
              <button
                type="button"
                className={`${styles.menuItem} ${
                  myReaction === "LIKE" ? styles.menuItemActive : ""
                }`}
                onClick={runAndClose(onLike)}
              >
                <ThumbUpIcon />
                <span>마음에 들어요</span>
              </button>
              <button
                type="button"
                className={`${styles.menuItem} ${
                  myReaction === "DISLIKE" ? styles.menuItemActive : ""
                }`}
                onClick={runAndClose(onDislike)}
              >
                <ThumbDownIcon />
                <span>별로예요</span>
              </button>
              <button
                type="button"
                className={`${styles.menuItem} ${
                  isArchived ? styles.menuItemActive : ""
                }`}
                onClick={runAndClose(onArchive)}
                disabled={isArchived}
              >
                <ArchiveIcon />
                <span>{isArchived ? "아카이브됨" : "아카이브"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ===== 아이콘 ===== */
const SearchIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#9a958f"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

const CloseIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M1.4 14L0 12.6L5.6 7L0 1.4L1.4 0L7 5.6L12.6 0L14 1.4L8.4 7L14 12.6L12.6 14L7 8.4L1.4 14Z"
      fill="currentColor"
    />
  </svg>
);

const EmptyIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5.33333 48C3.86667 48 2.61111 47.4778 1.56667 46.4333C0.522222 45.3889 0 44.1333 0 42.6667V5.33333C0 3.86667 0.522222 2.61111 1.56667 1.56667C2.61111 0.522222 3.86667 0 5.33333 0H42.6667C44.1333 0 45.3889 0.522222 46.4333 1.56667C47.4778 2.61111 48 3.86667 48 5.33333V42.6667C48 44.1333 47.4778 45.3889 46.4333 46.4333C45.3889 47.4778 44.1333 48 42.6667 48H5.33333ZM5.33333 42.6667H42.6667V5.33333H5.33333V42.6667ZM8 37.3333H40L30 24L22 34.6667L16 26.6667L8 37.3333ZM17.5 17.5C18.2778 16.7222 18.6667 15.7778 18.6667 14.6667C18.6667 13.5556 18.2778 12.6111 17.5 11.8333C16.7222 11.0556 15.7778 10.6667 14.6667 10.6667C13.5556 10.6667 12.6111 11.0556 11.8333 11.8333C11.0556 12.6111 10.6667 13.5556 10.6667 14.6667C10.6667 15.7778 11.0556 16.7222 11.8333 17.5C12.6111 18.2778 13.5556 18.6667 14.6667 18.6667C15.7778 18.6667 16.7222 18.2778 17.5 17.5Z"
      fill="#D8D7D5"
    />
  </svg>
);

const BrokenImageIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#c2bcb4"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 15l4-4 4 4M13 13l2-2 6 6" />
    <circle cx="8.5" cy="8.5" r="1.4" />
  </svg>
);

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="19" r="1.5" />
  </svg>
);

const PinIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 18 18"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M10.6066 12.728V15.5564L9.19239 16.9706L5.65686 13.4351L1.41422 17.6777H3.21865e-06V16.2635L4.24264 12.0209L0.70711 8.48536L2.12132 7.07114H4.94975L9.8995 2.1214L9.19239 1.41429L10.6066 7.55191e-05L17.6777 7.07114L16.2635 8.48536L15.5564 7.77825L10.6066 12.728Z" />
  </svg>
);

const ThumbUpIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 11v8a2 2 0 0 0 2 2h7.5a2 2 0 0 0 2-1.5l1.5-6.5a2 2 0 0 0-2-2.5h-4l.7-3.5a2 2 0 0 0-2-2.5L10 8 7 11z" />
  </svg>
);

const ThumbDownIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 13V5a2 2 0 0 0-2-2H7.5a2 2 0 0 0-2 1.5L4 11a2 2 0 0 0 2 2.5h4l-.7 3.5a2 2 0 0 0 2 2.5L14 16l3-3z" />
  </svg>
);

const ArchiveIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

export default ReferenceBoard;
