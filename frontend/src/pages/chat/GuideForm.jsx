import { useEffect, useRef, useState } from "react";
import { resizeImage, validateImageFile } from "./imageUtils";
import styles from "./GuideForm.module.css";
import { track as analyticsTrack } from "../../analytics";
import { useParams } from "react-router-dom";

// "어떤 점이 마음에 걸리나요?" 빠른 선택 칩 — 클릭 시 message 에 채움(편집 가능).
const CONCERNS = [
  "손이 어색해요",
  "얼굴이 어색해요",
  "입체감이 없어요",
  "구도가 단조로워요",
  "톤을 바꾸고 싶어요",
];

// 화풍 → 백엔드 track. 기획: 인물 주력 + 배경 지원. 실사/애니/치비 세분은 "자동"이 스타일을
//   감지해 norm 을 켜므로 UI 에선 인물/배경 2택 + 자동. "인물"=figure(레인 강제·norm OFF 안전),
//   "배경"=landscape(_SCENE_ORDER). "자동"은 track 미전달(prominence 로 인물↔배경 자동 판정).
const TRACKS = [
  { value: "", label: "자동 (AI 자동 판단)" },
  { value: "figure", label: "인물" },
  { value: "landscape", label: "배경" },
];

// 아이콘 — 프로젝트 관례(파일 내 인라인 SVG·currentColor)를 따름. Figma close_lg/info_sm/down_md 대응.
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

const InfoIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
  >
    <circle cx="8" cy="8" r="6.3" />
    <path d="M8 7.4v3.4" strokeLinecap="round" />
    <circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);

const GuideForm = ({ onSubmit, onClose, submitting }) => {
  const { projectId } = useParams();
  const inputRef = useRef(null);
  const previewRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  // 시안 SCR-GUIDE-01 화풍 기본값 = "자동 (AI 자동 판단)". 백엔드 auto 가 person.prominence 로
  // figure↔landscape 를 정확히 가름(풍경 오판 0, 실측). 사용자가 원하면 드롭다운으로 화풍 직접 지정 가능.
  const [track, setTrack] = useState("");
  const [intent, setIntent] = useState("practice"); // 작업중
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState(null);

  const imageUploadedAt = useRef(null);
  const chipSelectedAt = useRef({}); // { [chipContent]: timestamp }

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const pickFile = async (f) => {
    if (!f || submitting) return;
    const v = validateImageFile(f);
    if (v) {
      setErr(v);
      return;
    }
    setErr(null);
    const resized = await resizeImage(f);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(resized);
    previewRef.current = url;
    setFile(resized);
    setPreview(url);

    imageUploadedAt.current = Date.now();
    analyticsTrack("prompt_image_uploaded", {
      project_id: projectId,
      image_format: resized.type.split("/")[1] || "unknown",
      image_size_kb: Math.round(resized.size / 1024),
    });
  };

  const handleSubmit = () => {
    if (!file || submitting) return;
    const trimmedMessage = message.trim();
    const isChip = CONCERNS.includes(trimmedMessage);
    const hasChip = isChip;
    const hasTyped = trimmedMessage.length > 0 && !isChip;

    let inputMethod;
    if (hasChip) inputMethod = "chip_only";
    else if (hasTyped) inputMethod = "typed_only";
    else inputMethod = "typed_only"; // 기본

    const selectedChipIds = hasChip ? [trimmedMessage] : [];
    const imageStatus = intent === "practice" ? "in_progress" : "completed";

    analyticsTrack("prompt_image_with_context_submitted", {
      project_id: projectId,
      image_status: imageStatus,
      input_method: inputMethod,
      selected_chip_count: selectedChipIds.length,
      selected_chip_ids: selectedChipIds.join(","),
      typed_text_length: hasTyped ? trimmedMessage.length : 0,
    });
    onSubmit({
      file,
      previewUrl: preview,
      message: message.trim() || undefined,
      intent,
      track: track || undefined,
    });
  };

  // eslint-disable-next-line no-unused-vars -- GA4 핸들러: UI 연결 예정(develop)
  const handleIntentSelect = (newIntent) => {
    setIntent(newIntent);
    const imageStatus = newIntent === "practice" ? "in_progress" : "completed";

    analyticsTrack("prompt_image_status_selected", {
      project_id: projectId,
      image_status: imageStatus,
      time_to_select_sec: imageUploadedAt.current
        ? Math.round((Date.now() - imageUploadedAt.current) / 1000)
        : 0,
    });
  };

  // eslint-disable-next-line no-unused-vars -- GA4 핸들러: UI 연결 예정(develop)
  const handleChipClick = (chipContent, position) => {
    const isCurrentlyActive = message === chipContent;

    if (isCurrentlyActive) {
      // 같은 칩 다시 클릭 → 해제
      const selectedAt = chipSelectedAt.current[chipContent];
      const timeSelected = selectedAt
        ? Math.round((Date.now() - selectedAt) / 1000)
        : 0;

      analyticsTrack("prompt_chip_deselected", {
        project_id: projectId,
        chip_id: chipContent, // ID 없으면 content를 ID로 (또는 인덱스)
        time_selected_sec: timeSelected,
      });

      setMessage("");
      delete chipSelectedAt.current[chipContent];
    } else {
      // 새 칩 선택
      const imageStatus = intent === "practice" ? "in_progress" : "completed";

      analyticsTrack("prompt_chip_selected", {
        project_id: projectId,
        chip_id: chipContent,
        chip_content: chipContent,
        chip_position: position + 1, // 1부터
        chip_count: CONCERNS.length,
        image_status: imageStatus,
      });

      // 이전 활성 칩의 deselect 발화 (선택적)
      if (message && CONCERNS.includes(message)) {
        const prevSelectedAt = chipSelectedAt.current[message];
        analyticsTrack("prompt_chip_deselected", {
          project_id: projectId,
          chip_id: message,
          time_selected_sec: prevSelectedAt
            ? Math.round((Date.now() - prevSelectedAt) / 1000)
            : 0,
        });
        delete chipSelectedAt.current[message];
      }

      setMessage(chipContent);
      chipSelectedAt.current[chipContent] = Date.now();
    }
  };

  // 텍스트 필수화(시안 SCR-GUIDE-01): 파일 + 비지 않은 메시지(칩 클릭도 setMessage 로 채움)여야 제출.
  //   detect_terms 진입점 보장 → chat_feedback intent + request_text(B-2) 채워짐(우리 로직 스위치).
  const canSubmit = !!file && message.trim().length > 0 && !submitting;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="한 끗 가이드 입력"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>한 끗 가이드</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="닫기"
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.body}>
          {/* 그림 업로드 */}
          <label className={styles.fieldLabel}>그림 업로드</label>
          <div
            className={`${styles.dropzone} ${dragOver ? styles.dragOver : ""} ${
              preview ? styles.hasFile : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!submitting) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
          >
            {preview ? (
              <img className={styles.preview} src={preview} alt="미리보기" />
            ) : (
              <p className={styles.dropHint}>
                첨부할 파일을 여기에 끌어다 놓거나, 직접 선택해주세요.
              </p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={styles.pickBtn}
              onClick={() => inputRef.current?.click()}
              disabled={submitting}
            >
              {preview ? "다른 파일 선택" : "파일 선택"}
            </button>
          </div>
          {err && <p className={styles.err}>{err}</p>}

          {/* 걱정거리 */}
          <label className={styles.fieldLabel}>
            어떤 점이 마음에 걸리시나요? (필수){" "}
            <span
              className={styles.info}
              title="신경 쓰이는 부분을 적으면 그 부분 위주로 봐드려요."
            >
              <InfoIcon />
            </span>
          </label>
          <textarea
            className={styles.textarea}
            rows={2}
            placeholder="예) 정면 얼굴인데 양쪽 눈 크기가 미묘하게 달라요"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={submitting}
          />
          <div className={styles.chips}>
            {CONCERNS.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.chip} ${
                  message === c ? styles.chipActive : ""
                }`}
                onClick={() => setMessage(c)}
                disabled={submitting}
              >
                {c}
              </button>
            ))}
          </div>

          {/* 화풍 */}
          <label className={styles.fieldLabel}>이 그림의 화풍은</label>
          <select
            className={styles.select}
            value={track}
            onChange={(e) => setTrack(e.target.value)}
            disabled={submitting}
          >
            {TRACKS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          {/* 상태 — Figma 208:23767: 라벨과 토글이 한 행 */}
          <div className={styles.statusRow}>
            <label className={`${styles.fieldLabel} ${styles.statusLabel}`}>
              이 그림의 상태는
            </label>
            <div className={styles.toggle}>
              <button
                type="button"
                className={`${styles.toggleBtn} ${
                  intent === "practice" ? styles.toggleOn : ""
                }`}
                onClick={() => setIntent("practice")}
                disabled={submitting}
              >
                작업중
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${
                  intent === "finished" ? styles.toggleOn : ""
                }`}
                onClick={() => setIntent("finished")}
                disabled={submitting}
              >
                완성작
              </button>
            </div>
          </div>
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.submitBtn}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? "요청 중…" : "가이드 요청하기"}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default GuideForm;
