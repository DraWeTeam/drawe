import { useEffect, useRef, useState } from "react";
import styles from "./ProjectFormModal.module.css";
import { uploadImage } from "./api";
import AuthedImage from "../chat/AuthedImage";
import KeywordChips from "./KeywordChips";

// 표지 업로드 제약 — 백엔드 ImageUploadService 와 일치(형식/용량). 위반은 프론트에서 먼저 걸러 toast.
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const formatSize = (bytes) => {
  if (bytes == null) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
};

const CloseIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const UploadIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 10.5V2.5M8 2.5L4.5 6M8 2.5L11.5 6" />
    <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
  </svg>
);

const ErrorIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" fill="#fefeff" />
    <path d="M12 7v6" stroke="#dd3a2e" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12" cy="16.2" r="1.15" fill="#dd3a2e" />
  </svg>
);

// SCR-PROJ-04 프로젝트 수정 모달 (수정 전용 — 생성은 ProjectCreateModal).
//   표지 업로드 = POST /images/upload, 저장하기 = PATCH /projects/{id}.
const ProjectFormModal = ({ initial, onClose, onSubmit }) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [keywords, setKeywords] = useState(
    Array.isArray(initial?.keywords) ? initial.keywords : [],
  );
  const [description, setDescription] = useState(initial?.description ?? "");

  // 표지 미리보기(표시용) + coverPayload(저장용). payload: undefined=변경 없음, ""=제거, url=교체.
  const [coverPreview, setCoverPreview] = useState(
    initial?.coverImageUrl ?? null,
  );
  const [coverMeta, setCoverMeta] = useState(
    initial?.coverImageUrl
      ? {
          name: initial?.coverImageName ?? "표지 이미지",
          size: initial?.coverImageSize ?? null,
        }
      : null,
  );
  const coverPayload = useRef(undefined);
  const objectUrlRef = useRef(null); // 로컬 미리보기 objectURL 정리용

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fileInputRef = useRef(null);
  const toastTimer = useRef(null);
  const mouseDownTarget = useRef(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // 오류 toast — X 안 눌러도 약 3초 뒤 자동으로 사라짐.
  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  };

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      showToast("한번에 업로드할 수 있는 파일 개수는 1개입니다.");
      return;
    }
    const file = files[0];
    if (!ACCEPTED_TYPES.includes(file.type)) {
      showToast("지원하지 않는 형식이에요. (JPEG, PNG, WEBP)");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      showToast("파일 용량이 너무 커요. (최대 10MB)");
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadImage(file);
      // 미리보기는 로컬 objectURL(즉시·인증 불필요), 저장 payload 는 서버 url.
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const preview = URL.createObjectURL(file);
      objectUrlRef.current = preview;
      setCoverPreview(preview);
      setCoverMeta({ name: file.name, size: file.size });
      coverPayload.current = url;
    } catch {
      showToast("업로드에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveCover = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setCoverPreview(null);
    setCoverMeta(null);
    coverPayload.current = ""; // 제거 → 저장 시 표지 비움
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");
    if (!name.trim()) {
      setErrorMessage("이름은 필수입니다.");
      return;
    }
    const payload = {
      name: name.trim(),
      keywords,
      description: description.trim(),
    };
    // 표지가 바뀐 경우에만 전송(서명 url 을 되돌려 저장하는 사고 방지).
    //   파일명·용량도 함께 — 재진입 시 이름/크기 복원용(제거 시엔 빈 값→백엔드가 비움).
    if (coverPayload.current !== undefined) {
      payload.coverImageUrl = coverPayload.current;
      payload.coverImageName = coverMeta?.name ?? "";
      payload.coverImageSize = coverMeta?.size ?? null;
    }
    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message || "요청에 실패했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        mouseDownTarget.current = e.target;
      }}
      onMouseUp={(e) => {
        const onBackdrop =
          e.target === e.currentTarget &&
          mouseDownTarget.current === e.currentTarget;
        mouseDownTarget.current = null;
        if (onBackdrop) onClose();
      }}
    >
      {toast && (
        <div className={styles.toast} role="alert">
          <div className={styles.toastContent}>
            <span className={styles.toastIcon}>
              <ErrorIcon />
            </span>
            <span className={styles.toastLabel}>{toast}</span>
          </div>
          <button
            type="button"
            className={styles.toastClose}
            onClick={() => setToast("")}
            aria-label="닫기"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>프로젝트 수정</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="닫기"
          >
            <CloseIcon />
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.body}>
            {/* 프로젝트 표지 변경 */}
            <div className={styles.field}>
              <p className={styles.fieldTitle}>프로젝트 표지 변경</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = ""; // 같은 파일 재선택 허용
                }}
              />
              {coverPreview ? (
                <div className={styles.coverFilled}>
                  <div className={styles.coverThumb}>
                    <AuthedImage
                      className={styles.coverThumbImg}
                      src={coverPreview}
                      alt="프로젝트 표지 미리보기"
                    />
                    <button
                      type="button"
                      className={styles.coverRemove}
                      onClick={handleRemoveCover}
                      aria-label="표지 제거"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                  <div className={styles.coverMeta}>
                    <div className={styles.coverMetaText}>
                      <span className={styles.coverName}>
                        {coverMeta?.name}
                      </span>
                      {coverMeta?.size != null && (
                        <span className={styles.coverSize}>
                          {formatSize(coverMeta.size)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={styles.reselectBtn}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      <UploadIcon />
                      {uploading ? "업로드 중..." : "파일 선택"}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`${styles.dropzone} ${dragOver ? styles.dropzoneOver : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFiles(e.dataTransfer.files);
                  }}
                >
                  <p className={styles.dropzoneText}>
                    첨부할 파일을 여기에 끌어다 놓거나, 직접 선택해주세요.
                  </p>
                  <button
                    type="button"
                    className={styles.fileBtn}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? "업로드 중..." : "파일 선택"}
                  </button>
                </div>
              )}
            </div>

            {/* 프로젝트 이름 */}
            <div className={styles.field}>
              <label className={styles.fieldTitle} htmlFor="proj-name">
                프로젝트 이름
              </label>
              <input
                id="proj-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className={styles.input}
                placeholder="예) 봄 풍경 수채화"
              />
            </div>

            {/* 키워드 — 생성 모달과 동일한 재사용 컴포넌트 */}
            <div className={styles.field}>
              <p className={styles.fieldTitle}>키워드</p>
              <KeywordChips keywords={keywords} onChange={setKeywords} />
            </div>

            {/* 설명 */}
            <div className={styles.field}>
              <label className={styles.fieldTitle} htmlFor="proj-desc">
                설명
              </label>
              <textarea
                id="proj-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={styles.textarea}
                placeholder="프로젝트에 대한 설명을 자유롭게 적어주세요."
              />
            </div>

            {errorMessage && <p className={styles.error}>{errorMessage}</p>}
          </div>

          <div className={styles.footer}>
            <button
              type="button"
              onClick={onClose}
              className={styles.cancelBtn}
              disabled={submitting}
            >
              취소하기
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={submitting || uploading}
            >
              {submitting ? "저장 중..." : "저장하기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProjectFormModal;
