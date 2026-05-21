import { useEffect, useRef, useState } from "react";
import { uploadImage } from "./api";
import { resizeImage, validateImageFile } from "./imageUtils";
import styles from "./AttachmentPicker.module.css";

const AttachmentPicker = ({
  attachment,
  onAttach,
  onClear,
  onError,
  disabled,
}) => {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const previewUrlRef = useRef(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const handleFile = async (file) => {
    if (!file || uploading || disabled) return;
    const err = validateImageFile(file);
    if (err) {
      onError?.(err);
      return;
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;

    setUploading(true);
    try {
      const resized = await resizeImage(file);
      const { imageId, url } = await uploadImage(resized);
      onAttach({ imageId, url, previewUrl, format: file.type?.split('/')[1] || 'unknown',  // 'jpeg', 'png', 'webp' 등
      sizeKb: Math.round((resized?.size || file.size) / 1024), });
    } catch (e) {
      onError?.(
        e.response?.data?.error?.message || "이미지 업로드에 실패했어요.",
      );
      URL.revokeObjectURL(previewUrl);
      previewUrlRef.current = null;
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    handleFile(file);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  const handleClear = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    onClear();
  };

  return (
    <div
      className={`${styles.wrap} ${dragOver ? styles.dragOver : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled && !uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {attachment && (
        <div className={styles.pin}>
          <img src={attachment.previewUrl} alt="첨부 이미지" />
          <button
            type="button"
            className={styles.removeBtn}
            onClick={handleClear}
            aria-label="첨부 제거"
          >
            ×
          </button>
        </div>
      )}
      {uploading && !attachment && (
        <div className={styles.uploading}>업로드 중...</div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleInputChange}
        style={{ display: "none" }}
      />
      <button
        type="button"
        className={styles.clipBtn}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading || !!attachment}
        aria-label="이미지 첨부"
        title="이미지 첨부"
      >
        📎
      </button>
    </div>
  );
};

export default AttachmentPicker;
