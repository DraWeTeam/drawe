import { useEffect, useRef, useState } from "react";
import { validateImageFile } from "./imageUtils";
import styles from "./GuideRequestModal.module.css";

/**
 * GuideRequestModal — "한 끗 가이드" 입력 폼 모달.
 *
 * 첨부(클립) 버튼을 누르면 열린다. 그림 한 장 + 고민 메시지 + 보조 옵션을 받아
 * onSubmit({ file, message, medium, intent }) 으로 넘긴다.
 * 실제 업로드/전송은 부모(ChatPage)가 처리하며, 그때 submitting 으로 로딩을 표시한다.
 *
 * 백엔드는 첨부 이미지를 보고 의도를 분류해 가이드(coach) 응답을 돌려준다 —
 * 프론트는 여기서 입력만 모아 기존 채팅 전송 흐름에 실어 보낸다.
 */
const CHIPS = [
  "손이 어색해요",
  "얼굴이 어색해요",
  "입체감이 없어요",
  "구도가 단조로워요",
  "톤을 바꾸고 싶어요",
];

const GuideRequestModal = ({ onClose, onSubmit, submitting = false }) => {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [chipSel, setChipSel] = useState([]);
  const [medium, setMedium] = useState(""); // ""=자동, "sketch"=스케치
  const [intent, setIntent] = useState("open"); // open=작업중 / finished=완성작
  const [fileError, setFileError] = useState("");

  const fileRef = useRef(null);
  const previewRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const pickFile = (f) => {
    if (!f) {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
      setPreviewUrl(null);
      setFile(null);
      return;
    }
    const err = validateImageFile(f);
    if (err) {
      setFileError(err);
      return;
    }
    setFileError("");
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(f);
    previewRef.current = url;
    setPreviewUrl(url);
    setFile(f);
  };

  const toggleChip = (c) => {
    if (chipSel.includes(c)) {
      setChipSel((s) => s.filter((x) => x !== c));
      setMessage((m) => m.replace(c, "").replace(/\s+/g, " ").trim());
    } else {
      setChipSel((s) => [...s, c]);
      setMessage((m) => (m ? m + " " : "") + c);
    }
  };

  const handleSubmit = () => {
    if (!file || submitting) return;
    onSubmit({ file, message: message.trim(), medium, intent });
  };

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <h2 className={styles.title}>한 끗 가이드</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            disabled={submitting}
            aria-label="닫기"
          >
            <CloseIcon />
          </button>
        </div>

        <div className={styles.label}>그림 업로드</div>
        {!file ? (
          <div
            className={styles.drop}
            onClick={(e) => {
              if (e.target === e.currentTarget) fileRef.current?.click();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length > 1) {
                setFileError("한번에 업로드할 수 있는 파일 개수는 1개입니다.");
                return;
              }
              if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]);
            }}
          >
            첨부할 파일 한 장을 여기에 끌어다 놓거나, 직접 선택해주세요.
            <div>
              <button
                type="button"
                className={styles.pick}
                onClick={() => fileRef.current?.click()}
              >
                <UploadIcon /> 파일 선택
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.preview}>
            <div className={styles.thumb}>
              {previewUrl && <img src={previewUrl} alt="" />}
            </div>
            <div className={styles.fileInfo}>
              <div className={styles.fileName}>{file.name}</div>
              <div className={styles.fileSize}>
                {(file.size / 1024 / 1024).toFixed(1)}MB
              </div>
              <button
                type="button"
                className={styles.pick}
                onClick={() => fileRef.current?.click()}
              >
                <UploadIcon /> 파일 선택
              </button>
            </div>
            <button
              type="button"
              className={styles.removeFile}
              onClick={() => pickFile(null)}
              aria-label="첨부 제거"
            >
              <CloseIcon />
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files[0]) pickFile(e.target.files[0]);
            e.target.value = "";
          }}
        />
        {fileError && <div className={styles.fileError}>{fileError}</div>}

        <div className={styles.label}>어떤 점이 마음에 걸리시나요?</div>
        <input
          className={styles.textInput}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="예: 정면 얼굴인데 양쪽 눈 크기가 미묘하게 달라요"
        />
        <div className={styles.chips}>
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              className={chipSel.includes(c) ? styles.chipSel : styles.chip}
              onClick={() => toggleChip(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className={styles.label}>이 그림 화풍은</div>
        <select
          className={styles.select}
          value={medium}
          onChange={(e) => setMedium(e.target.value)}
        >
          <option value="">자동 (AI 자동 판단)</option>
          <option value="sketch">스케치</option>
        </select>

        <div className={styles.label}>이 그림의 상태는</div>
        <div className={styles.toggle}>
          <button
            type="button"
            className={intent === "open" ? styles.toggleSel : ""}
            onClick={() => setIntent("open")}
          >
            작업중
          </button>
          <button
            type="button"
            className={intent === "finished" ? styles.toggleSel : ""}
            onClick={() => setIntent("finished")}
          >
            완성작
          </button>
        </div>

        <button
          type="button"
          className={styles.submit}
          disabled={!file || submitting}
          onClick={handleSubmit}
        >
          {submitting ? (
            <>
              <span className={styles.spinner} /> 분석 중…
            </>
          ) : (
            "가이드 요청하기"
          )}
        </button>
      </div>
    </div>
  );
};

const CloseIcon = () => (
  <svg
    width="14"
    height="14"
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

const UploadIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </svg>
);

export default GuideRequestModal;
