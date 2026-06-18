import { track } from "../../analytics";
import styles from "./ProjectFormModal.module.css";
import { useEffect, useState, useRef } from "react";

const TECHNIQUE_OPTIONS = ["수채화", "유화", "연필", "색연필", "디지털"];
const MOOD_OPTIONS = ["밝은", "차분한", "따뜻한", "어두운", "몽환적인"];

// ↓ 한글 → 영문 매핑 (텍사노미 기준)
const TECHNIQUE_MAP = {
  수채화: "watercolor",
  유화: "oil",
  연필: "pencil",
  색연필: "colored_pencil",
  디지털: "digital",
};
const MOOD_MAP = {
  밝은: "bright",
  차분한: "calm",
  따뜻한: "warm",
  어두운: "dark",
  몽환적인: "dreamy",
};

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

  const mountTime = useRef(Date.now());
  const finalized = useRef(false); // 정상 종료(생성/취소) 플래그
  const formRef = useRef(form); // form 최신값 mirror (unmount 시 사용)
  const mouseDownTarget = useRef(null); // 마우스를 누르기 시작한 요소 (드래그 닫힘 방지)

  useEffect(() => {
    formRef.current = form;
  });

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

  useEffect(() => {
    return () => {
      if (isEdit) return;
      if (finalized.current) return; // 정상 종료면 패스

      const filled = getFilledFields(formRef.current);
      track("project_create_abandoned", {
        filled_fields: filled.join(","),
        filled_fields_count: filled.length,
        time_spent_sec: Math.floor((Date.now() - mountTime.current) / 1000),
      });
    };
  }, []);

  // ↓ 헬퍼: create 모드일 때만 발화
  const trackIfCreate = (eventName, properties) => {
    if (isEdit) return;
    track(eventName, properties);
  };

  // ↓ 헬퍼: 현재 채워진 필드 목록
  const getFilledFields = (f = form) => {
    const filled = [];
    if (f.name.trim()) filled.push("name");
    if (f.subject.trim()) filled.push("subject");
    if (f.technique) filled.push("technique");
    if (f.mood) filled.push("mood");
    if (f.description.trim()) filled.push("description");
    return filled;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));

    // ↓ 선택 필드는 변경 즉시 발화
    if ((name === "technique" || name === "mood") && value) {
      const mapped =
        name === "technique" ? TECHNIQUE_MAP[value] : MOOD_MAP[value];

      trackIfCreate("project_field_input", {
        field_name: name,
        input_type: "selected",
        selected_value: mapped || value,
      });
    }
  };

  const handleTextBlur = (e) => {
    const { name, value } = e.target;
    const trimmed = value.trim();
    if (!trimmed) return; // 빈 필드는 발화 안 함

    trackIfCreate("project_field_input", {
      field_name: name,
      input_type: "typed",
      input_length: trimmed.length,
    });
  };

  // 취소 버튼 클릭 → cancelled
  const handleCancelClick = () => {
    if (!isEdit) {
      const filled = getFilledFields();
      trackIfCreate("project_create_cancelled", {
        filled_fields: filled.join(","),
        filled_fields_count: filled.length,
        time_spent_sec: Math.floor((Date.now() - mountTime.current) / 1000),
      });
      finalized.current = true;
    }
    onClose();
  };

  // 누르기 시작한 요소 기록
  const handleBackdropMouseDown = (e) => {
    mouseDownTarget.current = e.target;
  };

  // 백드롭 mouseup → abandoned
  // 단, 누르기 시작·떼기 둘 다 백드롭 자체일 때만 닫는다.
  // (모달 내부에서 누르고 밖에서 떼는 드래그로 모달이 닫히는 문제 방지)
  const handleBackdropMouseUp = (e) => {
    const closedOnBackdrop =
      e.target === e.currentTarget &&
      mouseDownTarget.current === e.currentTarget;
    mouseDownTarget.current = null;
    if (!closedOnBackdrop) return;

    if (!isEdit) {
      const filled = getFilledFields();
      trackIfCreate("project_create_abandoned", {
        filled_fields: filled.join(","),
        filled_fields_count: filled.length,
        time_spent_sec: Math.floor((Date.now() - mountTime.current) / 1000),
      });
      finalized.current = true;
    }
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    if (!form.name.trim() || !form.subject.trim()) {
      const missing = [];
      if (!form.name.trim()) missing.push("name");
      if (!form.subject.trim()) missing.push("subject");

      trackIfCreate("project_field_validation_error", {
        missing_fields: missing.join(","),
      });

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

      // ↓ 생성 성공 (create 모드만)
      if (!isEdit) {
        finalized.current = true;

        trackIfCreate("project_created", {
          has_technique: !!form.technique,
          has_mood: !!form.mood,
          has_description: !!form.description.trim(),
          selected_technique: form.technique
            ? TECHNIQUE_MAP[form.technique]
            : null,
          selected_mood: form.mood ? MOOD_MAP[form.mood] : null,
          description_length: form.description.trim().length,
          total_time_sec: Math.floor((Date.now() - mountTime.current) / 1000),
          filled_fields_count: getFilledFields().length,
        });
      }
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "요청에 실패했습니다.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className={styles.modal}>
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
              onBlur={handleTextBlur}
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
              onBlur={handleTextBlur}
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
                <option key={t} value={t}>
                  {t}
                </option>
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
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.label}>
            설명
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              onBlur={handleTextBlur}
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
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}

          <div className={styles.actions}>
            <button
              type="button"
              onClick={handleCancelClick}
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
