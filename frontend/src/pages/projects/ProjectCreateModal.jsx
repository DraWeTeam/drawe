import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createProject, extractKeywords } from "./api";
import { getProfile } from "../settings/api";
import { searchReferenceBoard } from "../board/referenceBoardApi";
import KeywordChips from "./KeywordChips";
import { track } from "../../analytics";
import { useModalClose } from "./useModalClose";
import styles from "./ProjectCreateModal.module.css";

// distinct 유지(추출 결과에 중복이 와도 프론트에서 정리)
const distinct = (arr) => {
  const seen = new Set();
  const out = [];
  (arr || []).forEach((raw) => {
    const v = String(raw).trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  });
  return out;
};

/**
 * SCRUM-115 새 프로젝트 생성 플로우.
 *   1) 주제 입력 → "다음으로"(키워드 추출)
 *   2) 이름 + 키워드 편집 → "프로젝트 생성하기"
 *   3) 로딩(닉네임) → keywords 로 레퍼런스 검색 프리페치 → 보드로 자동 이동
 */
const ProjectCreateModal = ({ onClose }) => {
  const navigate = useNavigate();
  // 닫힘 애니메이션 — 취소/배경/닫기 시 pop-out 후 실제 onClose.
  const { closing, requestClose } = useModalClose(onClose);

  const [step, setStep] = useState("topic"); // "topic" | "keywords" | "loading"
  const [topic, setTopic] = useState("");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [nickname, setNickname] = useState("");
  // [트래킹] 주제 입력 project_field_input 중복 발사 방지(동일 내용 재-blur 무시).
  const topicTrackedRef = useRef("");
  // [트래킹] 모달 진입 시각 + 종료 결과(created/cancelled) — 취소/이탈 구분·체류시간 계산용.
  const [mountTime] = useState(() => Date.now());
  const resultRef = useRef(null); // null | "created" | "cancelled"
  const snapshotRef = useRef({ topic: "", name: "", keywords: [] });
  snapshotRef.current = { topic, name, keywords };

  // 취소/이탈 시점에 채워진 필드 목록(topic/name/keywords).
  const filledFields = () => {
    const s = snapshotRef.current;
    const f = [];
    if (s.topic.trim()) f.push("topic");
    if (s.name.trim()) f.push("name");
    if (s.keywords.length) f.push("keywords");
    return f;
  };

  // X(닫기) 버튼 = 명시적 취소 → project_create_cancelled.
  const handleCancel = () => {
    if (resultRef.current == null) {
      resultRef.current = "cancelled";
      const f = filledFields();
      track("project_create_cancelled", {
        filled_fields: f,
        filled_fields_count: f.length,
        time_spent_sec: Math.round((Date.now() - mountTime) / 1000),
      });
    }
    requestClose();
  };

  // 생성·취소 없이 모달이 사라지면(배경 클릭·페이지 이탈) → project_create_abandoned.
  useEffect(() => {
    return () => {
      if (resultRef.current == null) {
        const f = filledFields();
        track("project_create_abandoned", {
          filled_fields: f,
          filled_fields_count: f.length,
          time_spent_sec: Math.round((Date.now() - mountTime) / 1000),
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // [트래킹] 주제 입력창 blur(= 필드 입력 완료) 시 1회 project_field_input.
  //   실제 모달의 유일한 텍스트 입력이라 field_name 은 topic 만 수집(name/keyword 제외).
  const handleTopicBlur = () => {
    const v = topic.trim();
    if (!v || v === topicTrackedRef.current) return;
    topicTrackedRef.current = v;
    track("project_field_input", {
      field_name: "topic",
      input_type: "typed",
      input_length: v.length,
    });
  };

  useEffect(() => {
    getProfile()
      .then((p) => setNickname(p?.nickname || ""))
      .catch(() => {});
  }, []);

  // 1단계 → 2단계: 주제에서 이름·키워드 추출
  const handleExtract = async () => {
    const t = topic.trim();
    if (!t || extracting) return;
    setErrorMessage("");
    setExtracting(true);
    try {
      const data = await extractKeywords(t);
      setName(data?.name?.trim() || t);
      setKeywords(distinct(data?.keywords));
      setStep("keywords");
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message ||
          "키워드를 뽑지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setExtracting(false);
    }
  };

  // 2단계 → 생성 + 레퍼런스 프리페치 + 보드 이동
  const handleCreate = async () => {
    const finalName = name.trim();
    if (!finalName) return;
    setErrorMessage("");
    setStep("loading");
    try {
      const finalKeywords = distinct(keywords);
      const project = await createProject({
        name: finalName,
        keywords: finalKeywords,
        description: null,
      });
      resultRef.current = "created"; // 이탈 트래킹 억제
      track("project_created", {
        keyword_count: finalKeywords.length,
        topic_length: topic.trim().length,
      });

      const pid = String(project.id);
      // 새 프로젝트 → 보드 진입 시 튜토리얼 노출 플래그
      localStorage.setItem("drawe_show_project_tutorial", pid);
      localStorage.setItem("drawe_show_reaction_tutorial", pid);

      // SCRUM-113 검색 프리페치(키워드 결합) — 보드가 바로 결과를 보여주도록.
      const q = finalKeywords.join(" ").trim();
      let presetResults = null;
      if (q) {
        try {
          const data = await searchReferenceBoard(project.id, { q });
          presetResults = data?.results ?? [];
        } catch {
          presetResults = null; // 프리페치 실패해도 보드에서 재검색 가능
        }
      }

      navigate(`/projects/${project.id}/board`, {
        state: { presetQuery: q, presetResults },
      });
    } catch (err) {
      setStep("keywords");
      setErrorMessage(
        err.response?.data?.error?.message ||
          "프로젝트 생성에 실패했어요. 다시 시도해주세요.",
      );
    }
  };

  // ── 로딩 화면(전체) ──
  if (step === "loading") {
    return (
      <div className={styles.loadingScreen}>
        <p className={styles.loadingSub}>
          입력해주신 내용을 바탕으로 참고할만한 레퍼런스를 찾고 있어요.
        </p>
        <h2 className={styles.loadingTitle}>
          {nickname ? `${nickname}님` : "회원님"}을 위한 프로젝트를 만들고
          있어요!
        </h2>
        <div className={styles.loadingBar} aria-hidden>
          <span />
        </div>
      </div>
    );
  }

  // ── 모달(주제/키워드 단계) ──
  return (
    <div
      className={`${styles.backdrop} ${closing ? styles.backdropClosing : ""}`}
      onMouseDown={requestClose}
    >
      <div
        className={`${styles.modal} ${closing ? styles.modalClosing : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>새 프로젝트</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={handleCancel}
            aria-label="닫기"
          >
            <CloseIcon />
          </button>
        </div>

        {step === "topic" ? (
          <>
            <label className={styles.topicLabel}>
              어떤 그림을 그릴 건가요?
            </label>
            <textarea
              className={styles.textarea}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onBlur={handleTopicBlur}
              placeholder="예) 화창한 하늘을 배경으로 날아다니는 날개 달린 강아지"
              rows={4}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleExtract();
                }
              }}
            />
            {errorMessage && <p className={styles.error}>{errorMessage}</p>}
            <p className={styles.hint}>
              자세하게 적어주시면 더 정확한 가이드를 얻으실 수 있어요!
            </p>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!topic.trim() || extracting}
              onClick={handleExtract}
            >
              {extracting ? "키워드 뽑는 중…" : "다음으로"}
            </button>
          </>
        ) : (
          <>
            <label className={styles.fieldLabel}>프로젝트 이름</label>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />

            <label className={styles.fieldLabel}>키워드</label>
            <KeywordChips keywords={keywords} onChange={setKeywords} />

            {errorMessage && <p className={styles.error}>{errorMessage}</p>}
            <p className={styles.hint}>
              자세하게 적어주시면 더 정확한 가이드를 얻으실 수 있어요!
            </p>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!name.trim()}
              onClick={handleCreate}
            >
              프로젝트 생성하기
            </button>
          </>
        )}
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

export default ProjectCreateModal;
