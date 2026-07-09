import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getReferenceDetail,
  saveImageFeedback,
  removeImageFeedback,
  getCollections,
  createCollection,
  addReferenceToCollection,
} from "./api";
import { downloadImage } from "./download";
import { unsplashSized } from "../chat/imageUtils";
import TagChipEditor from "./TagChipEditor";
import AuthedImage from "../chat/AuthedImage";
import styles from "./ReferenceDetailPage.module.css";

// SCR-ARCH-05 레퍼런스 상세(전체화면) — 원본 이미지 + 이름 + 출처 링크 + 키워드 칩 + 반응(👍👎)
//   + 다운로드 + 아카이브(→ 컬렉션 선택 메뉴, + 새 컬렉션).
//   반응은 이미지 단위 피드백 API(/images/{id}/feedback) 재사용. 같은 반응 재클릭 = 취소.
//   진입: 컬렉션 상세 카드 or 레퍼런스 보드. 뒤로가기는 히스토리.
// sourceUrl 이 실제 URL(폴백 DraWe 도메인)인지, 프로젝트명 텍스트인지 구분.
const isUrl = (s) =>
  typeof s === "string" && (s.startsWith("http://") || s.startsWith("https://"));

// Unsplash 작가 프로필 링크(프로젝트 레퍼런스 상세와 동일 utm).
const unsplashProfile = (username) =>
  username
    ? `https://unsplash.com/@${username}?utm_source=drawe&utm_medium=referral`
    : null;

const ReferenceDetailPage = () => {
  const { imageId } = useParams();
  const navigate = useNavigate();
  const [ref, setRef] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [reaction, setReaction] = useState(null); // "LIKE" | "DISLIKE" | null
  const [downloading, setDownloading] = useState(false);

  // 아카이브 → 컬렉션 선택 메뉴.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [collections, setCollections] = useState([]);
  const [collLoading, setCollLoading] = useState(false);
  const [savedTo, setSavedTo] = useState(() => new Set()); // 방금 담은 컬렉션 id
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTags, setNewTags] = useState([]);
  const [tagDraft, setTagDraft] = useState("");
  const archiveRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const fetch = async () => {
      setLoading(true);
      setErrorMessage("");
      try {
        const data = await getReferenceDetail(imageId);
        if (alive) {
          setRef(data);
          setReaction(data.myReaction ?? null);
        }
      } catch (err) {
        if (alive)
          setErrorMessage(
            err.response?.data?.error?.message ||
              "레퍼런스를 불러오지 못했어요.",
          );
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetch();
    return () => {
      alive = false;
    };
  }, [imageId]);

  // 바깥 클릭 시 아카이브 메뉴 닫기.
  useEffect(() => {
    if (!archiveOpen) return;
    const onDown = (e) => {
      if (archiveRef.current && !archiveRef.current.contains(e.target)) {
        setArchiveOpen(false);
        setCreatingNew(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [archiveOpen]);

  // 반응 토글 — 같은 반응 재클릭이면 취소, 아니면 교체.
  const handleReaction = async (type) => {
    const next = reaction === type ? null : type;
    setReaction(next); // 낙관적 반영
    try {
      if (next == null) {
        await removeImageFeedback(imageId);
      } else {
        await saveImageFeedback(imageId, next);
      }
    } catch (err) {
      setReaction(reaction); // 롤백
      setErrorMessage(
        err.response?.data?.error?.message || "반응을 저장하지 못했어요.",
      );
    }
  };

  const handleDownload = async () => {
    if (!ref || downloading) return;
    setDownloading(true);
    try {
      await downloadImage(ref.imageId, ref.url);
    } finally {
      setDownloading(false);
    }
  };

  // 아카이브 버튼 — 메뉴 열면서 컬렉션 목록 로드.
  const openArchive = async () => {
    const willOpen = !archiveOpen;
    setArchiveOpen(willOpen);
    setCreatingNew(false);
    if (!willOpen) return;
    if (collections.length === 0) {
      setCollLoading(true);
      try {
        const data = await getCollections();
        setCollections(data?.collections ?? []);
      } catch {
        /* 무시 */
      } finally {
        setCollLoading(false);
      }
    }
  };

  // 기존 컬렉션에 담기.
  const saveToCollection = async (collectionId) => {
    try {
      await addReferenceToCollection(collectionId, Number(imageId));
      setSavedTo((prev) => new Set(prev).add(collectionId));
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "아카이브에 저장하지 못했어요.",
      );
    }
  };

  // + 새 컬렉션 생성 후 담기.
  const createAndSave = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const data = await createCollection({
        name,
        imageIds: [Number(imageId)],
        tags: newTags,
      });
      const id = data?.collectionId;
      setNewName("");
      setNewTags([]);
      setTagDraft("");
      setCreatingNew(false);
      setArchiveOpen(false);
      if (id) navigate(`/archive/collections/${id}`);
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "컬렉션을 만들지 못했어요.",
      );
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.stateBox}>불러오는 중…</div>
      </div>
    );
  }
  if (errorMessage && !ref) {
    return (
      <div className={styles.page}>
        <div className={styles.stateBox}>{errorMessage}</div>
      </div>
    );
  }

  const isUnsplash = ref.source === "UNSPLASH";
  const profileLink = unsplashProfile(ref.photographerUsername);

  return (
    <div className={styles.page}>
      {/* 헤더: 뒤로 + 이름 + 다운로드 + 아카이브 */}
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => navigate(-1)}
          aria-label="뒤로"
        >
          <ChevronLeft />
        </button>
        <h1 className={styles.title}>{ref.name}</h1>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleDownload}
            disabled={downloading}
            aria-label="다운로드"
            title="다운로드"
          >
            <DownloadIcon />
          </button>
          <div className={styles.archiveWrap} ref={archiveRef}>
            <button
              type="button"
              className={styles.archiveBtn}
              onClick={openArchive}
              aria-haspopup="true"
              aria-expanded={archiveOpen}
            >
              <ArchiveIcon /> 아카이브
            </button>
            {archiveOpen && (
              <div className={styles.archiveMenu}>
                <p className={styles.archiveMenuHead}>컬렉션에 저장</p>
                {collLoading ? (
                  <div className={styles.archiveMenuState}>불러오는 중…</div>
                ) : (
                  <div className={styles.archiveMenuList}>
                    {collections.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={styles.archiveMenuItem}
                        onClick={() => saveToCollection(c.id)}
                        disabled={savedTo.has(c.id)}
                      >
                        <span className={styles.archiveMenuName}>{c.name}</span>
                        {savedTo.has(c.id) && (
                          <span className={styles.savedMark}>저장됨</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {creatingNew ? (
                  <div className={styles.newCollBox}>
                    <div className={styles.newCollRow}>
                      <input
                        className={styles.newCollInput}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && createAndSave()
                        }
                        placeholder="새 컬렉션 이름"
                        autoFocus
                        maxLength={100}
                      />
                      <button
                        type="button"
                        className={styles.newCollSave}
                        onClick={createAndSave}
                        disabled={!newName.trim()}
                      >
                        생성
                      </button>
                    </div>
                    <TagChipEditor
                      tags={newTags}
                      draft={tagDraft}
                      onChange={setNewTags}
                      onDraftChange={setTagDraft}
                      placeholder="태그 추가 (선택)"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.newCollBtn}
                    onClick={() => setCreatingNew(true)}
                  >
                    <PlusIcon /> 새 컬렉션
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {errorMessage && <p className={styles.inlineError}>{errorMessage}</p>}

      {/* 본문: 좌 원본 이미지 + 우 정보 */}
      <div className={styles.body}>
        <div className={styles.imageBox}>
          {/* Unsplash 원본은 파라미터 없는 3~5MB 원본이라 상세에서 그대로 로드하면
              디코드 지연/실패로 빈 카드가 된다(레퍼런스 보드와 동일 이슈). imgix 리사이즈로
              상세용 큰 폭(1200)만 붙여 로드한다. 내부 /images 경로는 unsplashSized 가 그대로 통과. */}
          <AuthedImage
            src={unsplashSized(ref.url, 1200)}
            alt={ref.name}
            className={styles.image}
          />
        </div>

        <div className={styles.info}>
          {/* 이름: Unsplash 는 작가명(예 "Toa Heftiba"), 없으면 유도명. 프로젝트 레퍼런스 상세와 통일. */}
          <h2 className={styles.refName}>
            {isUnsplash ? ref.photographerName || ref.name : ref.name}
          </h2>

          {/* 출처: Unsplash 면 "Unsplash · @username"(작가 프로필 링크), 아니면 프로젝트명/도메인. */}
          {isUnsplash ? (
            profileLink ? (
              <a
                className={styles.sourceLink}
                href={profileLink}
                target="_blank"
                rel="noreferrer noopener"
              >
                Unsplash · @{ref.photographerUsername}
              </a>
            ) : (
              <span className={styles.sourceLabel}>Unsplash</span>
            )
          ) : isUrl(ref.sourceUrl) ? (
            <a
              className={styles.sourceLink}
              href={ref.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              www.DraWe.com
            </a>
          ) : (
            <span className={styles.sourceLabel}>{ref.sourceUrl}</span>
          )}

          {/* 태그 칩 — 프로젝트 레퍼런스 상세와 동일하게 AI 분류 3축(technique/subject/mood).
              백엔드가 이미 그 3개만 내려준다. */}
          {ref.keywords?.length > 0 && (
            <div className={styles.tags}>
              {ref.keywords.map((kw) => (
                <span key={kw} className={styles.tag}>
                  {kw}
                </span>
              ))}
            </div>
          )}

          {/* 관심 반응: 마음에 들어요 / 별로예요 */}
          <div className={styles.reactionRow}>
            <button
              type="button"
              className={`${styles.reactionBtn} ${reaction === "LIKE" ? styles.reactionActive : ""}`}
              onClick={() => handleReaction("LIKE")}
              aria-pressed={reaction === "LIKE"}
              title="마음에 들어요"
            >
              <ThumbUp />
            </button>
            <button
              type="button"
              className={`${styles.reactionBtn} ${reaction === "DISLIKE" ? styles.reactionActiveBad : ""}`}
              onClick={() => handleReaction("DISLIKE")}
              aria-pressed={reaction === "DISLIKE"}
              title="별로예요"
            >
              <ThumbDown />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ChevronLeft = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10.6667 16.1557L4.15567 9.64433L5.73333 8.04433L9.55567 11.8667V0H11.7777V11.8667L15.6 8.04433L17.1777 9.64433L10.6667 16.1557ZM2.22233 21.3333C1.62233 21.3333 1.10189 21.113 0.661 20.6723C0.220333 20.2314 0 19.711 0 19.111V14.6H2.22233V19.111H19.111V14.6H21.3333V19.111C21.3333 19.711 21.113 20.2314 20.6723 20.6723C20.2314 21.113 19.711 21.3333 19.111 21.3333H2.22233Z" fill="currentColor" />
  </svg>
);

const ArchiveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8" />
    <rect x="1" y="3" width="22" height="5" rx="1" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ThumbUp = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 10v11" />
    <path d="M18 21H8V10l5-8a2 2 0 0 1 2.8 2.5L14 9h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 18 21z" />
  </svg>
);

const ThumbDown = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 14V3" />
    <path d="M6 3h10v11l-5 8a2 2 0 0 1-2.8-2.5L10 15H4.5a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 6 3z" />
  </svg>
);

export default ReferenceDetailPage;
