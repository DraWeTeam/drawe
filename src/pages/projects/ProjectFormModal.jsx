import { useEffect, useState } from "react";
import styles from "./ProjectFormModal.module.css";

const TECHNIQUE_OPTIONS = ["수채화", "유화", "연필", "색연필", "디지털"];
const MOOD_OPTIONS = ["밝은", "차분한", "따뜻한", "어두운", "몽환적인"];
const STATUS_OPTIONS = [
  { value: "in_progress", label: "진행 중" },
  { value: "completed", label: "완료" },
];

const emptyForm = {
  name: "",
  subject: "",
  technique: "",
  mood: "",
  description: "",
  status: "in_progress",
};

const ProjectFormModal = ({ mode, initial, onClose, onSubmit }) => {
  const isEdit = mode === "edit";
  const [form, setForm] = useState(emptyForm);
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isEdit && initial) {
      setForm({
        name: initial.name ?? "",
        subject: initial.subject ?? "",
        technique: initial.technique ?? "",
        mood: initial.mood ?? "",
        description: initial.description ?? "",
        status: initial.status ?? "in_progress",
      });
    } else {
      setForm(emptyForm);
    }
  }, [isEdit, initial]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    if (!form.name.trim() || !form.subject.trim()) {
      setErrorMessage("이름과 주제는 필수입니다.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      subject: form.subject.trim(),
      technique: form.technique || undefined,
      mood: form.mood || undefined,
      description: form.description.trim() || undefined,
    };
    if (isEdit) payload.status = form.status;

    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "요청에 실패했습니다.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>
          {isEdit ? "프로젝트 수정" : "새 프로젝트"}
        </h2>
        <form onSubmit={handleSubmit}>
          <label className={styles.label}>
            이름 <span className={styles.required}>*</span>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              maxLength={100}
              className={styles.input}
              placeholder="예) 봄 풍경 수채화"
            />
          </label>

          <label className={styles.label}>
            주제 <span className={styles.required}>*</span>
            <input
              type="text"
              name="subject"
              value={form.subject}
              onChange={handleChange}
              maxLength={100}
              className={styles.input}
              placeholder="예) 벚꽃이 핀 공원"
            />
          </label>

          <label className={styles.label}>
            기법
            <select
              name="technique"
              value={form.technique}
              onChange={handleChange}
              className={styles.input}
            >
              <option value="">선택 안 함</option>
              {TECHNIQUE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>

          <label className={styles.label}>
            분위기
            <select
              name="mood"
              value={form.mood}
              onChange={handleChange}
              className={styles.input}
            >
              <option value="">선택 안 함</option>
              {MOOD_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>

          <label className={styles.label}>
            설명
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              className={styles.textarea}
              rows={3}
              placeholder="프로젝트에 대한 설명을 자유롭게 적어주세요"
            />
          </label>

          {isEdit && (
            <label className={styles.label}>
              상태
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
                className={styles.input}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
          )}

          {errorMessage && (
            <p className={styles.error}>{errorMessage}</p>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              onClick={onClose}
              className={styles.cancelBtn}
              disabled={submitting}
            >
              취소
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={submitting}
            >
              {submitting ? "처리 중..." : isEdit ? "저장" : "생성"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProjectFormModal;
