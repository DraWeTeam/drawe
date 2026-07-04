import { useLayoutEffect, useRef, useState } from "react";
import Tooltip from "../../components/Tooltip";
import TutorialCoachmark from "../chat/TutorialCoachmark";
import GuideForm from "../chat/GuideForm";
import GuideModal from "../chat/GuideModal";
import BoardGuideChat from "./BoardGuideChat";
import { requestGuide, uploadImage } from "../chat/api";
import { resizeImage, validateImageFile } from "../chat/imageUtils";
import { updateProject } from "../projects/api";
import { track } from "../../analytics";
import styles from "./GeneratePromptPanel.module.css";
import logo from "../../assets/drawe_logo.png";

const MAX_INPUT_HEIGHT = 160;

// 가이드 생성 ↔ 레퍼런스 생성 = 토글쌍. 프로젝트 완료는 별도 액션.
// 첫 화면(디폴트)은 둘 다 미선택 상태 → 기본 안내 문구 노출.
const DEFAULT_PLACEHOLDER =
  "가이드 생성 버튼을 클릭해서 나만의 그림 가이드를 받아보세요!";
const TOGGLE_MODES = {
  guide: {
    label: "가이드 생성",
    tooltip: "그림 업로드하고 가이드 받기",
    placeholder: "나의 그림에 딱맞는 가이드를 생성해보세요!",
  },
  reference: {
    label: "레퍼런스 생성",
    tooltip: "텍스트로 이미지 생성하기",
    placeholder: "원하는 레퍼런스 이미지를 묘사해주세요.",
  },
};

/**
 * 우측 프롬프트/생성 패널.
 * - 가이드 생성(기본 선택) ↔ 레퍼런스 생성: 토글쌍. 가이드 클릭 시 기존 '한 끗 가이드' 모달을 연다.
 * - 프로젝트 완료: 토글과 무관한 별도 액션(완성 그림 업로드 → 프로젝트 완료).
 * NOTE: 레퍼런스 '생성'(텍스트→이미지) 백엔드 연동은 팀원 담당. 여기선 입력 UI만.
 *
 * @param {string} projectId
 * @param {"guide"|"reference"} mode
 * @param {(m: "guide"|"reference") => void} onModeChange
 * @param {() => void} [onCollapse]
 */
const GeneratePromptPanel = ({
  projectId,
  mode,
  onModeChange,
  isFull,
  onExpand,
  onSplit,
  onCollapse,
  collectionOpen = false,
  onCollectionChange,
  onGuidesCount,
}) => {
  const [input, setInput] = useState("");
  const textareaRef = useRef(null);

  // 한 끗 가이드 — 입력 폼 + 결과 모달 (ChatPage 흐름 재사용)
  const [guideFormOpen, setGuideFormOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideResult, setGuideResult] = useState(null);
  const [guideError, setGuideError] = useState("");
  const [guidePreview, setGuidePreview] = useState(null);
  const lastGuideArgs = useRef(null);
  // /board 인라인 가이드 챗(BoardGuideChat): 복원 메시지 수로 인트로/스트림 토글 + 생성 후 새로고침.
  const [chatCount, setChatCount] = useState(0);
  const [chatReload, setChatReload] = useState(0);

  // 프로젝트 완료 — 완성 그림 파일 업로드
  const [completing, setCompleting] = useState(false);
  const completeInputRef = useRef(null);

  // 입력창 첨부 — 기존 이미지 업로드 재사용
  const [attachment, setAttachment] = useState(null); // { url, previewUrl }
  const [uploading, setUploading] = useState(false);
  const attachInputRef = useRef(null);

  // 첫 프로젝트 생성 시 노출되는 가이드 생성 튜토리얼(플래그는 해당 프로젝트 id).
  const guideBtnRef = useRef(null);
  const [showGuideTut, setShowGuideTut] = useState(
    () => localStorage.getItem("drawe_show_project_tutorial") === projectId,
  );
  const dismissGuideTut = () => {
    localStorage.removeItem("drawe_show_project_tutorial");
    setShowGuideTut(false);
  };

  // 미선택(null)이면 기본 안내 문구.
  const placeholder = TOGGLE_MODES[mode]?.placeholder ?? DEFAULT_PLACEHOLDER;
  // 입력창·파일 첨부는 레퍼런스 생성 모드에서만 활성(첫 화면·가이드는 비활성).
  const canType = mode === "reference";

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [input]);

  const handleGuideClick = () => {
    onModeChange?.("guide");
    setGuideFormOpen(true); // 가이드 버튼 클릭 → 한 끗 가이드 모달
  };

  const handleReferenceClick = () => {
    onModeChange?.("reference");
  };

  // 한 끗 가이드 폼 제출 → 결과 모달을 로딩 상태로 띄우고 requestGuide 호출.
  const handleGuideSubmit = async (args) => {
    const { file, previewUrl, message, intent, track: guideTrack } = args;
    lastGuideArgs.current = args;
    setGuideFormOpen(false);
    setGuideResult(null);
    setGuideError("");
    setGuidePreview(previewUrl || null);
    setGuideOpen(true);
    setGuideLoading(true);
    try {
      const result = await requestGuide(projectId, file, {
        message,
        intent,
        track: guideTrack,
      });
      setGuideResult(result);
      setGuidePreview(result?.uploadUrl || previewUrl || null);
      setChatReload((s) => s + 1); // 새 가이드 → 인라인 챗 재복원(새 결과카드 반영)
    } catch (err) {
      setGuideError(
        err.response?.data?.error?.message ||
          "가이드를 만들지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setGuideLoading(false);
    }
  };

  const retryGuide = () => {
    if (lastGuideArgs.current) handleGuideSubmit(lastGuideArgs.current);
  };

  const closeGuide = () => {
    setGuideOpen(false);
    setGuideResult(null);
    setGuideError("");
  };

  // 프로젝트 완료 — 완성 그림 선택 시 업로드 → 프로젝트 COMPLETED + drawingUrl 저장.
  const handleCompleteFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || completing) return;
    const err = validateImageFile(file);
    if (err) {
      alert(err);
      return;
    }
    setCompleting(true);
    try {
      const resized = await resizeImage(file);
      const { url } = await uploadImage(resized);
      await updateProject(projectId, { status: "COMPLETED", drawingUrl: url });
      track("project_completed", { project_id: projectId });
      alert("완성작으로 저장했어요! 완성작 갤러리에서 볼 수 있어요.");
    } catch (e2) {
      alert(
        e2.response?.data?.error?.message ||
          "완료 처리에 실패했어요. 다시 시도해주세요.",
      );
    } finally {
      setCompleting(false);
    }
  };

  // 입력창 첨부 — 파일 선택 → 리사이즈 → 업로드(기존 uploadImage). 미리보기 저장.
  const handleAttachFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || uploading) return;
    const err = validateImageFile(file);
    if (err) {
      alert(err);
      return;
    }
    setUploading(true);
    try {
      const resized = await resizeImage(file);
      const previewUrl = URL.createObjectURL(resized);
      const { url } = await uploadImage(resized);
      setAttachment((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { url, previewUrl };
      });
    } catch (e2) {
      alert(
        e2.response?.data?.error?.message ||
          "이미지 업로드에 실패했어요. 다시 시도해주세요.",
      );
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = () => {
    setAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  };

  // 생성 로직(텍스트→이미지)은 팀원 담당 — 지금은 전송 동작 없음(UI만).
  const handleSubmit = (e) => {
    e.preventDefault();
  };

  return (
    <div className={styles.panel}>
      {/* 상단 컨트롤 (⛶ / ≫) — 전체보기 상태에선 분할 복귀 버튼만 */}
      <div className={styles.topBar}>
        {isFull ? (
          <>
            <span />
            <Tooltip label="분할 보기" placement="bottom">
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onSplit}
                aria-label="분할 보기"
              >
                <ChevronsRightIcon />
              </button>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip label="전체화면 보기" placement="bottom">
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onExpand}
                aria-label="전체화면 보기"
              >
                <ExpandIcon />
              </button>
            </Tooltip>
            <Tooltip label="접기" placement="bottom">
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onCollapse}
                aria-label="접기"
              >
                <ChevronsRightIcon />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {/* 메시지 영역 — 복원된 인라인 가이드 챗(BoardGuideChat, BOARD-01 66:26420 정본).
          가이드가 없으면 인트로, 있으면 버블+인라인 결과카드 스트림. ChatPage 미접촉 조립. */}
      <div className={styles.messages}>
        {chatCount === 0 && (
          <div className={styles.intro}>
            <img className={styles.introLogo} src={logo} alt="" />
            <h2 className={styles.introTitle}>어떤 도움이 필요하신가요?</h2>
          </div>
        )}
        <BoardGuideChat
          projectId={projectId}
          reloadSignal={chatReload}
          onCount={setChatCount}
          collectionOpen={collectionOpen}
          onCollectionChange={onCollectionChange}
          onGuidesCount={onGuidesCount}
        />
      </div>

      {/* 프롬프트 바 */}
      <form className={styles.promptBar} onSubmit={handleSubmit}>
        <div className={styles.modeRow}>
          {/* 토글쌍: 가이드 생성 / 레퍼런스 생성 */}
          <Tooltip label={TOGGLE_MODES.guide.tooltip} placement="top">
            <button
              ref={guideBtnRef}
              type="button"
              className={`${styles.modeBtn} ${
                mode === "guide" ? styles.modeBtnActive : ""
              }`}
              onClick={handleGuideClick}
            >
              <SparkleIcon />
              <span>{TOGGLE_MODES.guide.label}</span>
            </button>
          </Tooltip>
          <Tooltip label={TOGGLE_MODES.reference.tooltip} placement="top">
            <button
              type="button"
              className={`${styles.modeBtn} ${
                mode === "reference" ? styles.modeBtnActive : ""
              }`}
              onClick={handleReferenceClick}
            >
              <span>{TOGGLE_MODES.reference.label}</span>
            </button>
          </Tooltip>

          {/* 별도 액션: 프로젝트 완료 */}
          <input
            ref={completeInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleCompleteFile}
            style={{ display: "none" }}
          />
          <Tooltip label="완성된 그림 업로드하기" placement="top">
            <button
              type="button"
              className={styles.completeBtn}
              onClick={() => completeInputRef.current?.click()}
              disabled={completing}
            >
              {completing ? "완료 중…" : "프로젝트 완료"}
            </button>
          </Tooltip>
        </div>

        {/* 첨부 미리보기 */}
        {canType && attachment && (
          <div className={styles.attachmentPreviews}>
            <div className={styles.previewItem}>
              <img
                src={attachment.previewUrl}
                alt="첨부"
                className={styles.previewImage}
              />
              <button
                type="button"
                className={styles.previewRemove}
                onClick={removeAttachment}
                aria-label="첨부 제거"
              >
                ×
              </button>
            </div>
          </div>
        )}

        <div className={styles.inputRow}>
          {canType && (
            <>
              <input
                ref={attachInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleAttachFile}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className={styles.attachBtn}
                onClick={() => attachInputRef.current?.click()}
                disabled={uploading}
                aria-label="파일 첨부"
              >
                <ClipIcon />
              </button>
            </>
          )}
          <textarea
            ref={textareaRef}
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            disabled={!canType}
            rows={1}
          />
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={!canType || !input.trim()}
            aria-label="전송"
          >
            <SendIcon />
          </button>
        </div>
      </form>

      {/* 한 끗 가이드 입력 폼 */}
      {guideFormOpen && (
        <GuideForm
          onSubmit={handleGuideSubmit}
          onClose={() => setGuideFormOpen(false)}
          submitting={guideLoading}
        />
      )}

      {/* 한 끗 가이드 결과 모달 */}
      {guideOpen && (
        <GuideModal
          result={guideResult}
          loading={guideLoading}
          error={guideError}
          drawingPreviewUrl={guidePreview}
          onClose={closeGuide}
          onRetry={retryGuide}
          onRefFeedback={() => {}}
        />
      )}

      {/* 첫 프로젝트 진입 튜토리얼 — 가이드 생성 버튼 위 */}
      {showGuideTut && (
        <TutorialCoachmark
          anchorRef={guideBtnRef}
          onClose={dismissGuideTut}
          placement="top"
          step="1 of 1"
          title="가이드를 생성해보세요"
          description="그리는 중이거나 완성한 그림을 올리면, 딱 맞는 한 끗 가이드를 받아볼 수 있어요."
        />
      )}
    </div>
  );
};

/* ===== 아이콘 ===== */
const ExpandIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path
      d="M0 18V13H2V16H5V18H0ZM13 18V16H16V13H18V18H13ZM0 5V0H5V2H2V5H0ZM16 5V2H13V0H18V5H16Z"
      fill="#4A4846"
    />
  </svg>
);

const ChevronsRightIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#4A4846"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 17l5-5-5-5M13 17l5-5-5-5" />
  </svg>
);

const SparkleIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10.2809 14.9165C10.2065 14.6281 10.0561 14.3649 9.84555 14.1543C9.63495 13.9437 9.37176 13.7934 9.08336 13.719L3.97086 12.4006C3.88364 12.3759 3.80687 12.3233 3.75221 12.251C3.69754 12.1787 3.66797 12.0905 3.66797 11.9998C3.66797 11.9091 3.69754 11.8209 3.75221 11.7486C3.80687 11.6763 3.88364 11.6237 3.97086 11.599L9.08336 10.2798C9.37166 10.2055 9.63477 10.0553 9.84537 9.84483C10.056 9.63439 10.2063 9.37137 10.2809 9.08314L11.5992 3.97063C11.6237 3.88307 11.6762 3.80592 11.7486 3.75096C11.8211 3.69601 11.9095 3.66626 12.0004 3.66626C12.0914 3.66626 12.1798 3.69601 12.2523 3.75096C12.3247 3.80592 12.3772 3.88307 12.4017 3.97063L13.7192 9.08314C13.7936 9.37153 13.9439 9.63472 14.1545 9.84532C14.3651 10.0559 14.6283 10.2062 14.9167 10.2806L20.0292 11.5981C20.1171 11.6224 20.1946 11.6748 20.2499 11.7474C20.3052 11.8199 20.3351 11.9086 20.3351 11.9998C20.3351 12.091 20.3052 12.1797 20.2499 12.2522C20.1946 12.3248 20.1171 12.3772 20.0292 12.4015L14.9167 13.719C14.6283 13.7934 14.3651 13.9437 14.1545 14.1543C13.9439 14.3649 13.7936 14.6281 13.7192 14.9165L12.4009 20.029C12.3764 20.1165 12.3239 20.1937 12.2514 20.2486C12.179 20.3036 12.0905 20.3333 11.9996 20.3333C11.9087 20.3333 11.8202 20.3036 11.7478 20.2486C11.6754 20.1937 11.6229 20.1165 11.5984 20.029L10.2809 14.9165Z"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M18.6665 4.5V7.83333"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M20.3333 6.16675H17"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.3335 16.167V17.8337"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6.16667 17H4.5"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ClipIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M7 16V3.825L1.4 9.425L0 8L8 0L16 8L14.6 9.425L9 3.825V16H7Z"
      fill="#FCFBFA"
    />
  </svg>
);

export default GeneratePromptPanel;
