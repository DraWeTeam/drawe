import { useEffect, useRef, useState } from "react";
import styles from "./KeywordChips.module.css";

/**
 * 키워드 칩 편집기 (SCRUM-115).
 *   - 칩 텍스트 클릭 → 인라인 편집 / ✕ → 삭제
 *   - "직접 추가" → 입력 칩 → Enter 로 추가
 *   - distinct 유지: 빈 입력 무시, 중복은 추가 안 하고 해당 칩 shake, 긴 라벨은 CSS …
 *
 * @param {string[]} keywords
 * @param {(next: string[]) => void} onChange
 */
const KeywordChips = ({ keywords, onChange }) => {
  const [addingValue, setAddingValue] = useState(null); // null = "직접 추가" 버튼, 문자열 = 입력 중
  const [editIndex, setEditIndex] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [shakeIdx, setShakeIdx] = useState(null);
  // 편집/추가 시 입력창 폭 — 클릭한 칩(또는 "직접 추가" 버튼)의 실제 폭을 그대로 써서 크기가 안 튀게.
  const [editWidth, setEditWidth] = useState(null);
  const [addWidth, setAddWidth] = useState(null);

  const addRef = useRef(null);
  const editRef = useRef(null);
  const shakeTimer = useRef(null);

  useEffect(() => {
    if (addingValue !== null) addRef.current?.focus();
  }, [addingValue]);

  useEffect(() => {
    if (editIndex !== null) editRef.current?.focus();
  }, [editIndex]);

  useEffect(() => () => clearTimeout(shakeTimer.current), []);

  // 중복 칩 흔들기(피드백) — 잠깐 후 해제
  const triggerShake = (idx) => {
    setShakeIdx(idx);
    clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShakeIdx(null), 450);
  };

  const indexOfKeyword = (value, exceptIdx = -1) =>
    keywords.findIndex((k, i) => i !== exceptIdx && k === value);

  const removeAt = (idx) => {
    onChange(keywords.filter((_, i) => i !== idx));
  };

  // ── 편집 ──
  const startEdit = (idx, e) => {
    // 클릭한 칩(버튼의 부모 span)의 실제 폭을 캡처 → 입력창도 같은 폭.
    const chipEl = e?.currentTarget?.parentElement;
    setEditWidth(chipEl ? chipEl.offsetWidth : null);
    setEditIndex(idx);
    setEditValue(keywords[idx]);
  };

  const commitEdit = () => {
    if (editIndex === null) return;
    const value = editValue.trim();
    const idx = editIndex;
    setEditIndex(null);
    if (!value || value === keywords[idx]) return; // 빈 입력/변경 없음 → 원래대로
    const dup = indexOfKeyword(value, idx);
    if (dup !== -1) {
      triggerShake(dup); // 중복 → 반영 안 하고 흔들기
      return;
    }
    onChange(keywords.map((k, i) => (i === idx ? value : k)));
  };

  // ── 직접 추가 ──
  const commitAdd = () => {
    const value = (addingValue ?? "").trim();
    if (!value) return; // 빈 입력 엔터 → 무시(입력 상태 유지)
    const dup = indexOfKeyword(value);
    if (dup !== -1) {
      triggerShake(dup); // 중복 → 추가 안 하고 흔들기(입력 유지)
      return;
    }
    onChange([...keywords, value]);
    setAddingValue(""); // 추가 후 계속 입력할 수 있게 비움
  };

  return (
    <div className={styles.chips}>
      {keywords.map((kw, i) =>
        editIndex === i ? (
          <input
            key={`edit-${i}`}
            ref={editRef}
            className={styles.chipInput}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEdit();
              } else if (e.key === "Escape") {
                setEditIndex(null);
              }
            }}
            onBlur={commitEdit}
            maxLength={20}
            style={editWidth ? { width: editWidth } : undefined}
          />
        ) : (
          <span
            key={`chip-${i}`}
            className={`${styles.chip} ${shakeIdx === i ? styles.shake : ""}`}
          >
            <button
              type="button"
              className={styles.chipText}
              onClick={(e) => startEdit(i, e)}
              title={kw}
            >
              {kw}
            </button>
            <button
              type="button"
              className={styles.chipRemove}
              onClick={() => removeAt(i)}
              aria-label={`${kw} 삭제`}
            >
              <CloseIcon />
            </button>
          </span>
        ),
      )}

      {addingValue !== null ? (
        <input
          ref={addRef}
          className={styles.chipInput}
          value={addingValue}
          onChange={(e) => setAddingValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitAdd();
            } else if (e.key === "Escape") {
              setAddingValue(null);
            }
          }}
          onBlur={() => setAddingValue(null)}
          maxLength={20}
          style={addWidth ? { width: addWidth } : undefined}
        />
      ) : (
        <button
          type="button"
          className={styles.addChip}
          onClick={(e) => {
            setAddWidth(e.currentTarget.offsetWidth);
            setAddingValue("");
          }}
        >
          직접 추가
        </button>
      )}
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

export default KeywordChips;
