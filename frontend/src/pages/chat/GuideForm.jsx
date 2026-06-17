import { useEffect, useRef, useState } from "react";
import { resizeImage, validateImageFile } from "./imageUtils";
import styles from "./GuideForm.module.css";

// "어떤 점이 마음에 걸리나요?" 빠른 선택 칩 — 클릭 시 message 에 채움(편집 가능).
const CONCERNS = [
  "손이 어색해요",
  "얼굴이 어색해요",
  "입체감이 없어요",
  "구도가 단조로워요",
  "톤을 바꾸고 싶어요",
];

// 화풍 → 백엔드 track enum. '자동'은 track 미전달(파이프라인이 자동 판단).
// NOTE: 와이어프레임의 '스케치' 등은 현재 backend track enum 에 없음 — 옵션은 팀과 정합 필요.
const TRACKS = [
  { value: "", label: "자동 (AI 자동 판단)" },
  { value: "realistic_figure", label: "실사 인물" },
  { value: "anime_figure", label: "애니 인물" },
  { value: "chibi_figure", label: "치비 / SD" },
  { value: "landscape", label: "풍경" },
];

const GuideForm = ({ onSubmit, onClose, submitting }) => {
  const inputRef = useRef(null);
  const previewRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  // 인물-우선 제품 → 기본을 figure 레인(실사 인물)으로. 명시 track 이 백엔드 자동판단을 덮으므로
  // 스케치 CLIP 오분류(인물→풍경)를 결정적으로 회피. 풍경/애니/치비는 사용자가 직접 선택.
  const [track, setTrack] = useState("realistic_figure");
  const [intent, setIntent] = useState("practice"); // 작업중
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState(null);

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
  };

  const handleSubmit = () => {
    if (!file || submitting) return;
    onSubmit({
      file,
      previewUrl: preview,
      message: message.trim() || undefined,
      intent,
      track: track || undefined,
    });
  };

  const canSubmit = !!file && !submitting;

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
            ×
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
                첨부할 파일 한 장을 여기다 끌어다 놓거나, 직접 선택해주세요.
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
            어떤 점이 마음에 걸리나요?{" "}
            <span
              className={styles.info}
              title="신경 쓰이는 부분을 적으면 그 부분 위주로 봐드려요."
            >
              ⓘ
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
          <label className={styles.fieldLabel}>이 그림 화풍은</label>
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

          {/* 상태 */}
          <label className={styles.fieldLabel}>이 그림의 상태는</label>
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
