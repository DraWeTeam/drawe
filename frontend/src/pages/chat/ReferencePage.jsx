import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import api from "../login/api";
import Tooltip from "../../components/Tooltip";
import styles from "./ReferencePage.module.css";
import { track } from "../../analytics";
import { downloadImage } from "../gallery/download";
import { addReference } from "../projects/api";
import { unsplashSized } from "./imageUtils";

const ReferencePage = () => {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const location = useLocation();

  const reference = location.state?.reference || null;
  const position = location.state?.position || 0; // ← 추가
  const iterationCount = location.state?.iterationCount || 0; // ← 추가
  const inputMode = location.state?.inputMode || "text"; // ← 추가
  const [userFeedback, setUserFeedback] = useState(null); // 'LIKE' | 'DISLIKE' | null
  const [feedbackLoading, setFeedbackLoading] = useState(true); // 추가
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

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

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // 소유 이미지(id)면 실제 파일 다운로드, 외부 소스면 새 탭 폴백.
      await downloadImage(reference?.id, reference?.url);
    } finally {
      setDownloading(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (!reference?.id) {
      alert("저장할 수 없는 이미지예요.");
      return;
    }
    setSaving(true);
    try {
      await addReference(projectId, reference.id);
      alert("아카이브에 저장했어요!");
      track("reference_archived", {
        reference_id: reference.id,
        project_id: projectId,
      });
    } catch (err) {
      // 백엔드 메시지를 그대로 노출.
      const message =
        err.response?.data?.error?.message || "저장에 실패했어요. 다시 시도해주세요.";
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const handleLike = async () => {
    if (feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    // 트래킹용 — 변경 전 상태 캡처
    const previous = userFeedback;
    const lastFeedbackTime = parseInt(
      localStorage.getItem(`feedback_time_${reference.id}`) || "0",
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
        reference_tags: reference?.tags?.join(",") || "", // ← 추가
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
      localStorage.setItem(
        `feedback_time_${reference.id}`,
        Date.now().toString(),
      );
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
      localStorage.getItem(`feedback_time_${reference.id}`) || "0",
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
        reference_tags: reference?.tags?.join(",") || "", // ← 추가
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
      localStorage.setItem(
        `feedback_time_${reference.id}`,
        Date.now().toString(),
      );
    } catch (err) {
      console.error("피드백 저장 실패", err);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <Tooltip label="뒤로가기" placement="bottom">
          <button
            className={styles.backBtn}
            onClick={handleBack}
            aria-label="뒤로가기"
          >
            <BackIcon />
          </button>
        </Tooltip>
        <div className={styles.topActions}>
          <Tooltip label="다운로드" placement="bottom">
            <button
              className={styles.iconBtn}
              onClick={handleDownload}
              disabled={downloading}
              aria-label="다운로드"
            >
              <DownloadIcon />
            </button>
          </Tooltip>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.imageArea}>
          {imgFailed ? (
            <div className={styles.imageError}>
              이미지를 불러오지 못했어요.
            </div>
          ) : (
            <img
              src={unsplashSized(reference.url, 1080)}
              alt={reference.photographerName || "참고 이미지"}
              className={styles.image}
              onError={() => setImgFailed(true)}
            />
          )}
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
            <Tooltip label="마음에 들어요" placement="bottom">
              <button
                className={`${styles.feedbackBtn} ${
                  userFeedback === "LIKE" ? styles.active : ""
                }`}
                onClick={handleLike}
                disabled={feedbackLoading || feedbackSubmitting}
                aria-label="마음에 들어요"
                aria-pressed={userFeedback === "LIKE"}
              >
                <ThumbsUpIcon />
              </button>
            </Tooltip>
            <Tooltip label="관심 없어요" placement="bottom">
              <button
                className={`${styles.feedbackBtn} ${
                  userFeedback === "DISLIKE" ? styles.active : ""
                }`}
                onClick={handleDislike}
                disabled={feedbackLoading || feedbackSubmitting}
                aria-label="관심 없어요"
                aria-pressed={userFeedback === "DISLIKE"}
              >
                <ThumbsDownIcon />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
};

const DownloadIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 22 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10.6667 16.1557L4.15567 9.64433L5.73333 8.04433L9.55567 11.8667V0H11.7777V11.8667L15.6 8.04433L17.1777 9.64433L10.6667 16.1557ZM2.22233 21.3333C1.62233 21.3333 1.10189 21.113 0.661 20.6723C0.220333 20.2314 0 19.711 0 19.111V14.6H2.22233V19.111H19.111V14.6H21.3333V19.111C21.3333 19.711 21.113 20.2314 20.6723 20.6723C20.2314 21.113 19.711 21.3333 19.111 21.3333H2.22233Z"
      fill="#4A4846"
    />
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
    height="22"
    viewBox="0 0 24 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M18.2857 22H5.71429V7.7L13.7143 0L15.1429 1.375C15.2762 1.50333 15.3857 1.6775 15.4714 1.8975C15.5571 2.1175 15.6 2.32833 15.6 2.53V2.915L14.3429 7.7H21.7143C22.3238 7.7 22.8571 7.92 23.3143 8.36C23.7714 8.8 24 9.31333 24 9.9V12.1C24 12.2283 23.981 12.3658 23.9429 12.5125C23.9048 12.6592 23.8667 12.7967 23.8286 12.925L20.4 20.68C20.2286 21.0467 19.9429 21.3583 19.5429 21.615C19.1429 21.8717 18.7238 22 18.2857 22ZM8 19.8H18.2857L21.7143 12.1V9.9H11.4286L12.9714 3.85L8 8.635V19.8ZM5.71429 7.7V9.9H2.28571V19.8H5.71429V22H0V7.7H5.71429Z"
      fill="currentColor"
    />
  </svg>
);

const ThumbsDownIcon = () => (
  <svg
    width="24"
    height="22"
    viewBox="0 0 24 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5.71429 -1.59859e-06L18.2857 -4.99559e-07L18.2857 14.3L10.2857 22L8.85714 20.625C8.72381 20.4967 8.61428 20.3225 8.52857 20.1025C8.44286 19.8825 8.4 19.6717 8.4 19.47L8.4 19.085L9.65714 14.3L2.28571 14.3C1.67619 14.3 1.14286 14.08 0.685714 13.64C0.228572 13.2 -1.09315e-06 12.6867 -1.04186e-06 12.1L-8.49533e-07 9.9C-8.38314e-07 9.77166 0.019046 9.63416 0.0571414 9.4875C0.0952369 9.34083 0.133332 9.20333 0.171428 9.075L3.6 1.32C3.77143 0.953329 4.05714 0.641665 4.45714 0.384999C4.85714 0.128332 5.27619 -1.63689e-06 5.71429 -1.59859e-06ZM16 2.2L5.71429 2.2L2.28571 9.9L2.28571 12.1L12.5714 12.1L11.0286 18.15L16 13.365L16 2.2ZM18.2857 14.3L18.2857 12.1L21.7143 12.1L21.7143 2.2L18.2857 2.2L18.2857 -4.99559e-07L24 0L24 14.3L18.2857 14.3Z"
      fill="currentColor"
    />
  </svg>
);

const BackIcon = () => (
  <svg
    width="12"
    height="20"
    viewBox="0 0 12 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10 20L0 10L10 0L11.775 1.775L3.55 10L11.775 18.225L10 20Z"
      fill="#4A4846"
    />
  </svg>
);

export default ReferencePage;
