import { useEffect, useRef, useState } from "react";
import { uploadImage } from "./api";
import { resizeImage, validateImageFile } from "./imageUtils";
import styles from "./AttachmentPicker.module.css";

const AttachmentPicker = ({ attachment, onAttach, onError, disabled }) => {
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
      onAttach({
        imageId,
        url,
        previewUrl,
        format: file.type?.split("/")[1] || "unknown", // 'jpeg', 'png', 'webp' 등
        sizeKb: Math.round((resized?.size || file.size) / 1024),
      });
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
        <Picker />
      </button>
    </div>
  );
};

/* ===== 아이콘 ===== */
const Picker = () => (
  <svg
    width="13"
    height="20"
    viewBox="0 0 13 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12.5 13.75C12.5 15.4833 11.8917 16.9583 10.675 18.175C9.45833 19.3917 7.98333 20 6.25 20C4.51667 20 3.04167 19.3917 1.825 18.175C0.608333 16.9583 0 15.4833 0 13.75V4.5C0 3.25 0.4375 2.1875 1.3125 1.3125C2.1875 0.4375 3.25 0 4.5 0C5.75 0 6.8125 0.4375 7.6875 1.3125C8.5625 2.1875 9 3.25 9 4.5V13.25C9 14.0167 8.73333 14.6667 8.2 15.2C7.66667 15.7333 7.01667 16 6.25 16C5.48333 16 4.83333 15.7333 4.3 15.2C3.76667 14.6667 3.5 14.0167 3.5 13.25V4H5.5V13.25C5.5 13.4667 5.57083 13.6458 5.7125 13.7875C5.85417 13.9292 6.03333 14 6.25 14C6.46667 14 6.64583 13.9292 6.7875 13.7875C6.92917 13.6458 7 13.4667 7 13.25V4.5C6.98333 3.8 6.7375 3.20833 6.2625 2.725C5.7875 2.24167 5.2 2 4.5 2C3.8 2 3.20833 2.24167 2.725 2.725C2.24167 3.20833 2 3.8 2 4.5V13.75C1.98333 14.9333 2.39167 15.9375 3.225 16.7625C4.05833 17.5875 5.06667 18 6.25 18C7.41667 18 8.40833 17.5875 9.225 16.7625C10.0417 15.9375 10.4667 14.9333 10.5 13.75V4H12.5V13.75Z"
      fill="#4A4846"
    />
  </svg>
);

export default AttachmentPicker;
