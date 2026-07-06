import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Tooltip from "../../components/Tooltip";
import { deleteProject, getProject, updateProject } from "../projects/api";
import ProjectFormModal from "../projects/ProjectFormModal";
import ConfirmModal from "../projects/ConfirmModal";
import ReferenceBoard from "./ReferenceBoard";
import GeneratePromptPanel from "./GeneratePromptPanel";
import { GuideContent } from "../chat/GuideModal";
import styles from "./ReferenceBoardPage.module.css";
import logo from "../../assets/drawe_logo.png";

/**
 * SCR-BOARD-01 — 작업공간(split).
 * 좌: 키워드 검색 레퍼런스 보드 / 우: 프롬프트·생성 패널.
 * 채팅 기반 추천을 걷어낸 새 워크스페이스. 기존 /chat 은 그대로 두고 별도 라우트로 제공한다.
 *
 * 레이아웃 모드(ChatPage 동일):
 *   "split"     — 좌/우 분할
 *   "boardFull" — 보드 전체보기(우측 숨김 + 하단 로고 FAB로 분할 복귀)
 *   "genFull"   — 생성 패널 전체보기(좌측 숨김)
 */
const ReferenceBoardPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // 생성 직후 진입 시 프리페치된 검색어/결과(SCRUM-115) — 보드가 바로 표시.
  const presetQuery = location.state?.presetQuery ?? "";
  const presetResults = location.state?.presetResults ?? null;

  const [project, setProject] = useState(null);
  const [promptMode, setPromptMode] = useState(null); // 첫 화면: 토글 둘 다 미선택
  const [mode, setMode] = useState("split");

  // 가이드 모아보기 — 헤더 아이콘(가이드 1회+ 게이팅) → BoardGuideChat 오버레이 제어(Figma 66:26453).
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [guidesCount, setGuidesCount] = useState(0);
  // ⑧ 가이드 상세 — 좌측 반 오버레이(SCR-GUIDE-03-1 split). 카드 클릭 → 좌측 보드 위를 덮고, 닫기 → 보드 복귀.
  const [guideDetail, setGuideDetail] = useState(null);
  // 정본: 가이드 생성 결과도 중앙 모달이 아니라 좌측 인라인 패널에 표시(로딩/에러 포함). GeneratePromptPanel 이 보고.
  const [genGuide, setGenGuide] = useState(null);
  // SCRUM-118 — 우측에서 생성한 레퍼런스(AI)를 좌측 보드 하단 "내 생성물" 레인으로 흘려보낸다.
  const [generatedImage, setGeneratedImage] = useState(null);

  // 헤더 ⋮ 메뉴(프로젝트 수정/삭제)
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    (async () => {
      try {
        const detail = await getProject(projectId);
        if (alive) setProject(detail);
      } catch {
        // 제목은 부가 정보 — 실패해도 보드는 동작
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 바깥 클릭으로 ⋮ 메뉴 닫기
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

  // 생성 유도 모달에서 "생성하러 가기" → 우측 패널을 열고 레퍼런스 생성 모드로.
  const handleRequestGenerate = () => {
    setMode((m) => (m === "boardFull" ? "split" : m));
    setPromptMode("reference");
  };

  const handleEditSubmit = async (payload) => {
    await updateProject(projectId, payload);
    setEditOpen(false);
    // 제목 등 반영을 위해 다시 조회
    try {
      const detail = await getProject(projectId);
      setProject(detail);
    } catch {
      setProject((prev) => (prev ? { ...prev, ...payload } : prev));
    }
  };

  const handleDelete = async () => {
    await deleteProject(projectId);
    setDeleteOpen(false);
    navigate("/projects");
  };

  return (
    <div className={styles.layout}>
      {/* 헤더 */}
      <header className={styles.header}>
        <Tooltip label="뒤로가기" placement="bottom">
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate("/projects")}
            aria-label="뒤로가기"
          >
            <BackIcon />
          </button>
        </Tooltip>
        <h1 className={styles.title}>{project?.name ?? "..."}</h1>

        {/* 가이드 모아보기 — 가이드 1회+ 일 때 노출(Figma 헤더 우상단 66:26453). */}
        {guidesCount > 0 && (
          <Tooltip label="가이드 모아보기" placement="bottom">
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setCollectionOpen(true)}
              aria-label="가이드 모아보기"
            >
              <CollectionIcon />
            </button>
          </Tooltip>
        )}

        <div className={styles.menuWrap} ref={menuRef}>
          <Tooltip label="더보기" placement="bottom">
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="더보기"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <DotsIcon />
            </button>
          </Tooltip>
          {menuOpen && (
            <div className={styles.menuPopup} role="menu">
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  setEditOpen(true);
                }}
              >
                <EditIcon />
                <span>프로젝트 수정</span>
              </button>
              <button
                type="button"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  setMenuOpen(false);
                  setDeleteOpen(true);
                }}
              >
                <TrashIcon />
                <span>삭제하기</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 본문 — 좌/우 분할 */}
      <div className={styles.body}>
        <aside
          className={`${styles.leftPanel} ${
            mode === "genFull" ? styles.panelHidden : ""
          }`}
        >
          <ReferenceBoard
            projectId={projectId}
            onRequestGenerate={handleRequestGenerate}
            expanded={mode === "boardFull"}
            initialQuery={presetQuery || project?.lastReferenceQuery || ""}
            initialResults={presetResults}
            generatedImage={generatedImage}
          />
          {/* ⑧ 가이드 상세/생성 — 좌측 반 인라인 패널(중앙 모달 대신). 생성(genGuide) 우선, 없으면 카드 상세(guideDetail). */}
          {(genGuide?.open || guideDetail) && (
            <div className={styles.guideOverlay}>
              <GuideContent
                result={genGuide?.open ? genGuide.result : guideDetail}
                loading={genGuide?.open ? genGuide.loading : false}
                error={genGuide?.open ? genGuide.error : false}
                projectId={projectId}
                drawingPreviewUrl={
                  genGuide?.open
                    ? genGuide.drawingPreviewUrl
                    : guideDetail?.guidePreview
                }
                onClose={
                  genGuide?.open ? genGuide.onClose : () => setGuideDetail(null)
                }
                onRetry={genGuide?.open ? genGuide.onRetry : undefined}
              />
            </div>
          )}
        </aside>

        <section
          className={`${styles.rightPanel} ${
            mode === "boardFull" ? styles.panelHidden : ""
          }`}
        >
          <GeneratePromptPanel
            projectId={projectId}
            mode={promptMode}
            onModeChange={setPromptMode}
            isFull={mode === "genFull"}
            onExpand={() => setMode("genFull")}
            onSplit={() => setMode("split")}
            onCollapse={() => setMode("boardFull")}
            collectionOpen={collectionOpen}
            onCollectionChange={setCollectionOpen}
            onGuidesCount={setGuidesCount}
            onOpenGuide={setGuideDetail}
            onGuideState={setGenGuide}
            onGenerated={setGeneratedImage}
          />
        </section>
      </div>

      {/* FAB — 보드 전체보기일 때 하단에 노출, 클릭 시 분할 복귀 */}
      <div
        className={`${styles.fabTip} ${
          mode === "boardFull" ? styles.fabTipVisible : ""
        }`}
      >
        <Tooltip label="생성 패널 열기" placement="top">
          <button
            type="button"
            className={styles.fab}
            onClick={() => setMode("split")}
            aria-label="생성 패널 열기"
          >
            <img className={styles.fabIcon} src={logo} alt="" />
          </button>
        </Tooltip>
      </div>

      {editOpen && project && (
        <ProjectFormModal
          mode="edit"
          initial={project}
          onClose={() => setEditOpen(false)}
          onSubmit={handleEditSubmit}
        />
      )}

      {deleteOpen && (
        <ConfirmModal
          title="프로젝트 삭제"
          description={`모든 레퍼런스와 대화 기록이 삭제됩니다. 정말로 ${
            project?.name ?? "이 프로젝트"
          }을 삭제하시겠어요?`}
          confirmLabel="삭제하기"
          cancelLabel="취소하기"
          onConfirm={handleDelete}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
};

const BackIcon = () => (
  <svg width="12" height="20" viewBox="0 0 12 20" fill="none">
    <path
      d="M10 20L0 10L10 0L11.775 1.775L3.55 10L11.775 18.225L10 20Z"
      fill="#4A4846"
    />
  </svg>
);

const CollectionIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="#4A4846"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

const DotsIcon = () => (
  <svg width="4" height="16" viewBox="0 0 4 16" fill="none">
    <path
      d="M2 16C1.45 16 0.979167 15.8042 0.5875 15.4125C0.195833 15.0208 0 14.55 0 14C0 13.45 0.195833 12.9792 0.5875 12.5875C0.979167 12.1958 1.45 12 2 12C2.55 12 3.02083 12.1958 3.4125 12.5875C3.80417 12.9792 4 13.45 4 14C4 14.55 3.80417 15.0208 3.4125 15.4125C3.02083 15.8042 2.55 16 2 16ZM2 10C1.45 10 0.979167 9.80417 0.5875 9.4125C0.195833 9.02083 0 8.55 0 8C0 7.45 0.195833 6.97917 0.5875 6.5875C0.979167 6.19583 1.45 6 2 6C2.55 6 3.02083 6.19583 3.4125 6.5875C3.80417 6.97917 4 7.45 4 8C4 8.55 3.80417 9.02083 3.4125 9.4125C3.02083 9.80417 2.55 10 2 10ZM2 4C1.45 4 0.979167 3.80417 0.5875 3.4125C0.195833 3.02083 0 2.55 0 2C0 1.45 0.195833 0.979167 0.5875 0.5875C0.979167 0.195833 1.45 0 2 0C2.55 0 3.02083 0.195833 3.4125 0.5875C3.80417 0.979167 4 1.45 4 2C4 2.55 3.80417 3.02083 3.4125 3.4125C3.02083 3.80417 2.55 4 2 4Z"
      fill="#4A4846"
    />
  </svg>
);

const EditIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path
      d="M2 16H3.425L13.2 6.225L11.775 4.8L2 14.575V16ZM0 18V13.75L13.2 0.575C13.4 0.391667 13.6208 0.25 13.8625 0.15C14.1042 0.05 14.3583 0 14.625 0C14.8917 0 15.15 0.05 15.4 0.15C15.65 0.25 15.8667 0.4 16.05 0.6L17.425 2C17.625 2.18333 17.7708 2.4 17.8625 2.65C17.9542 2.9 18 3.15 18 3.4C18 3.66667 17.9542 3.92083 17.8625 4.1625C17.7708 4.40417 17.625 4.625 17.425 4.825L4.25 18H0ZM12.475 5.525L11.775 4.8L13.2 6.225L12.475 5.525Z"
      fill="#4A4846"
    />
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
    <path
      d="M3 18C2.45 18 1.97917 17.8042 1.5875 17.4125C1.19583 17.0208 1 16.55 1 16V3H0V1H5V0H11V1H16V3H15V16C15 16.55 14.8042 17.0208 14.4125 17.4125C14.0208 17.8042 13.55 18 13 18H3ZM13 3H3V16H13V3ZM5 14H7V5H5V14ZM9 14H11V5H9V14Z"
      fill="#DD3A2E"
    />
  </svg>
);

export default ReferenceBoardPage;
