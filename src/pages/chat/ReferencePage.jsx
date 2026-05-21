import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import api from "../login/api";
import styles from "./ReferencePage.module.css";
import { track } from "../../analytics";


const ReferencePage = () => {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const location = useLocation();

  const reference = location.state?.reference || null;
  const position = location.state?.position || 0;                   // ← 추가
  const iterationCount = location.state?.iterationCount || 0;       // ← 추가
  const inputMode = location.state?.inputMode || "text";            // ← 추가
  const [userFeedback, setUserFeedback] = useState(null); // 'LIKE' | 'DISLIKE' | null
  const [feedbackLoading, setFeedbackLoading] = useState(true); // 추가
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  // reference 없으면 챗으로 돌아감
  useEffect(() => {
    if (!reference) {
      navigate(`/projects/${projectId}/chat`);
    }
  }, [reference, projectId, navigate]);

  // 추가 — 페이지 진입 시 피드백 상태 조회
  useEffect(() => {
    if (!reference) return;

    const fetchFeedback = async () => {
      try {
        const res = await api.get(`/images/${reference.id}/feedback`);
        const type = res.data.data?.type;
        setUserFeedback(type); // "LIKE", "DISLIKE", 또는 null
      } catch (err) {
        console.error("피드백 조회 실패:", err);
        setUserFeedback(null);
      } finally {
        setFeedbackLoading(false);
      }
    };

    fetchFeedback();
  }, [reference]);

  if (!reference) return null;

  // AI 생성 vs 외부 소스 판별
  const isAiGenerated =
    reference.source &&
    reference.source !== "UNSPLASH" &&
    reference.source !== "PEXELS";

  const photographerLink = reference.photographerUsername
    ? "https://unsplash.com/@" +
      reference.photographerUsername +
      "?utm_source=drawe&utm_medium=referral"
    : null;

  const tags = [reference.technique, reference.subject, reference.mood].filter(
    Boolean,
  );

  const handleBack = () => {
    navigate(-1);
  };

  const handleDownload = () => {
    if (!reference?.url) return;
    window.open(reference.url, "_blank", "noopener,noreferrer");
  };

  const handleSave = () => {
    alert("프로젝트에 저장 기능은 곧 추가될 예정이에요!");
  };

  const handleLike = async () => {
    if (feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    // 트래킹용 — 변경 전 상태 캡처
    const previous = userFeedback;
    const lastFeedbackTime = parseInt(
      localStorage.getItem(`feedback_time_${reference.id}`) || "0"
    );

    try {
      let actionType;
      let feedbackType;

      if (userFeedback === "LIKE") {
        await api.delete(`/images/${reference.id}/feedback`);
        setUserFeedback(null);
        actionType = "removed";
        feedbackType = "none";
      } else {
        await api.post(`/images/${reference.id}/feedback`, { type: "LIKE" });
        setUserFeedback("LIKE");
        actionType = previous === null ? "applied" : "changed";
        feedbackType = "like";
      }
      // 트래킹
      const props = {
        reference_id: reference.id,
        action_type: actionType,
        feedback_type: feedbackType,
        previous_feedback_type: previous ? previous.toLowerCase() : "none",
        reference_position: position,
        iteration_count: iterationCount,
        input_mode: inputMode,
        project_id: projectId,
      };
      
      // changed/removed일 때만 이전 피드백 후 경과 시간 추가
      if (actionType === "changed" || actionType === "removed") {
        props.time_since_previous_sec = lastFeedbackTime
          ? Math.floor((Date.now() - lastFeedbackTime) / 1000)
          : 0;
      }
      
      track("prompt_reference_feedback", props);
      localStorage.setItem(`feedback_time_${reference.id}`, Date.now().toString());
    } catch (err) {
      console.error("피드백 저장 실패", err);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleDislike = async () => {
    if (feedbackSubmitting) return;
    setFeedbackSubmitting(true);

    const previous = userFeedback;
    const lastFeedbackTime = parseInt(
      localStorage.getItem(`feedback_time_${reference.id}`) || "0"
    );

    try {
      let actionType;
      let feedbackType;
      if (userFeedback === "DISLIKE") {
        await api.delete(`/images/${reference.id}/feedback`);
        setUserFeedback(null);
        actionType = "removed";
        feedbackType = "none";
      } else {
        await api.post(`/images/${reference.id}/feedback`, { type: "DISLIKE" });
        setUserFeedback("DISLIKE");
        actionType = previous === null ? "applied" : "changed";
        feedbackType = "dislike";
      }
      const props = {
      reference_id: reference.id,
      action_type: actionType,
      feedback_type: feedbackType,
      previous_feedback_type: previous ? previous.toLowerCase() : "none",
      reference_position: position,
      iteration_count: iterationCount,
      input_mode: inputMode,
      project_id: projectId,
    };
    
    if (actionType === "changed" || actionType === "removed") {
      props.time_since_previous_sec = lastFeedbackTime
        ? Math.floor((Date.now() - lastFeedbackTime) / 1000)
        : 0;
    }
    
    track("prompt_reference_feedback", props);
    localStorage.setItem(`feedback_time_${reference.id}`, Date.now().toString());
    } catch (err) {
      console.error("피드백 저장 실패", err);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button
          className={styles.backBtn}
          onClick={handleBack}
          aria-label="뒤로 가기"
        >
          ←
        </button>
        <div className={styles.topActions}>
          <button
            className={styles.iconBtn}
            onClick={handleDownload}
            aria-label="이미지 다운로드"
          >
            <DownloadIcon />
          </button>
          <button className={styles.saveBtn} onClick={handleSave}>
            저장
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.imageArea}>
          <img
            src={reference.url}
            alt={reference.photographerName || "참고 이미지"}
            className={styles.image}
          />
        </div>

        <div className={styles.infoPanel}>
          <h2 className={styles.title}>
            {isAiGenerated
              ? "AI 생성 이미지"
              : reference.photographerName || "레퍼런스"}
          </h2>

          {isAiGenerated ? (
            <span className={styles.aiSource}>
              <SparkleIcon /> AI Generated
            </span>
          ) : photographerLink ? (
            <a
              href={photographerLink}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.source}
            >
              Unsplash · @{reference.photographerUsername}
            </a>
          ) : (
            <span className={styles.source}>Unsplash</span>
          )}

          {(isAiGenerated || tags.length > 0) && (
            <div className={styles.tags}>
              {isAiGenerated && (
                <span className={styles.aiBadge}>
                  <SparkleIcon /> AI
                </span>
              )}
              {tags.map((tag, idx) => (
                <span key={idx} className={styles.tag}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className={styles.feedback}>
            <button
              className={`${styles.feedbackBtn} ${
                userFeedback === "LIKE" ? styles.active : ""
              }`}
              onClick={handleLike}
              disabled={feedbackLoading || feedbackSubmitting}
              aria-label="좋아요"
              aria-pressed={userFeedback === "LIKE"}
            >
              <ThumbsUpIcon />
            </button>
            <button
              className={`${styles.feedbackBtn} ${
                userFeedback === "DISLIKE" ? styles.active : ""
              }`}
              onClick={handleDislike}
              disabled={feedbackLoading || feedbackSubmitting}
              aria-label="싫어요"
              aria-pressed={userFeedback === "DISLIKE"}
            >
              <ThumbsDownIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const DownloadIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const SparkleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0l2.5 8.5L23 11l-8.5 2.5L12 22l-2.5-8.5L1 11l8.5-2.5z" />
  </svg>
);

const ThumbsUpIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M7 11v8a2 2 0 0 0 2 2h7.5a2 2 0 0 0 2-1.5l1.5-6.5a2 2 0 0 0-2-2.5h-4l.7-3.5a2 2 0 0 0-2-2.5L10 8 7 11z" />
  </svg>
);

const ThumbsDownIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M17 13V5a2 2 0 0 0-2-2H7.5a2 2 0 0 0-2 1.5L4 11a2 2 0 0 0 2 2.5h4l-.7 3.5a2 2 0 0 0 2 2.5L14 16l3-3z" />
  </svg>
);

export default ReferencePage;
