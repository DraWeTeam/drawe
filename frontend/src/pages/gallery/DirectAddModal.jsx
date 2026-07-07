import { useRef, useState } from "react";
import { uploadImage } from "../chat/api";
import { createCollection } from "./api";
import styles from "./CollectionDetailPage.module.css";

// SCR-ARCH-02 '직접 추가하기' — 새 컬렉션을 만든다.
//   이미지는 0~10개(없어도 빈 컬렉션 생성 가능), 태그는 사용자가 수동 입력.
//   파일이 있으면 uploadImage(/images/upload)로 올려 imageId 를 모으고, createCollection(name,imageIds,tags)로 만든다.
const MAX_FILES = 10;

const DirectAddModal = ({ onCancel, onCreated }) => {
  const [name, setName] = useState("");
  const [files, setFiles] = useState([]); // File[]
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const onPick = (e) => {
    const picked = Array.from(e.target.files ?? []);
    setError("");
    setFiles((prev) => {
      const merged = [...prev, ...picked].slice(0, MAX_FILES);
      if (prev.length + picked.length > MAX_FILES) {
        setError(`이미지는 최대 ${MAX_FILES}개까지 올릴 수 있어요.`);
      }
      return merged;
    });
    e.target.value = "";
  };

  const removeFile = (idx) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const addTag = () => {
    const t = tagDraft.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagDraft("");
  };

  const onTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagDraft && tags.length) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  // 이미지 없이도 이름만 있으면 생성 가능.
  const canSubmit = name.trim() && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      // 파일이 있으면 업로드해 imageId 수집(없으면 빈 컬렉션).
      const imageIds = [];
      for (const file of files) {
        const data = await uploadImage(file);
        const imageId = data?.imageId ?? data?.id;
        if (imageId != null) imageIds.push(imageId);
      }
      const res = await createCollection({
        name: name.trim(),
        imageIds,
        tags,
      });
      onCreated?.(res?.collectionId);
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          err.message ||
          "컬렉션을 만들지 못했어요.",
      );
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.modalOverlay}
      onClick={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`${styles.modal} ${styles.modalWide}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.modalTitle}>직접 추가하기</h3>

        <label className={styles.fieldLabel}>컬렉션 이름</label>
        <input
          className={styles.textInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="새 컬렉션 이름"
        />

        <label className={styles.fieldLabel}>
          이미지 ({files.length}/{MAX_FILES})
        </label>
        <p className={styles.fieldHint}>
          이미지는 나중에 추가해도 돼요. 없이 만들 수도 있어요.
        </p>
        <div className={styles.uploadGrid}>
          {files.map((file, i) => (
            <div key={i} className={styles.uploadThumb}>
              <img
                src={URL.createObjectURL(file)}
                alt=""
                className={styles.uploadThumbImg}
              />
              <button
                type="button"
                className={styles.uploadRemove}
                onClick={() => removeFile(i)}
                aria-label="이미지 제거"
                disabled={busy}
              >
                ×
              </button>
            </div>
          ))}
          {files.length < MAX_FILES && (
            <button
              type="button"
              className={styles.uploadAdd}
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              +
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onPick}
        />

        <label className={styles.fieldLabel}>태그</label>
        <p className={styles.fieldHint}>
          컬렉션을 설명하는 태그를 직접 입력하세요. (Enter로 추가)
        </p>
        <div className={styles.tagEditor}>
          {tags.map((tag) => (
            <span key={tag} className={styles.tagChip}>
              {tag}
              <button
                type="button"
                className={styles.tagRemove}
                onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                aria-label={`${tag} 태그 삭제`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            className={styles.tagInput}
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={onTagKeyDown}
            onBlur={addTag}
            placeholder="태그 입력 후 Enter"
          />
          <button
            type="button"
            className={styles.tagAddBtn}
            onClick={addTag}
            disabled={!tagDraft.trim()}
            aria-label="태그 추가"
          >
            추가
          </button>
        </div>

        {error && <p className={styles.modalError}>{error}</p>}

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.modalCancel}
            onClick={onCancel}
            disabled={busy}
          >
            취소하기
          </button>
          <button
            type="button"
            className={styles.modalSave}
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? "만드는 중…" : "추가하기"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DirectAddModal;
