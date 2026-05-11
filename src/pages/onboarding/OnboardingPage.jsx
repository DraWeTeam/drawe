import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getOnboardingImages, submitOnboarding } from "./api";
import styles from "./OnboardingPage.module.css";

const OnboardingPage = () => {
  const navigate = useNavigate();
  const [images, setImages] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchImages = async () => {
      try {
        const data = await getOnboardingImages();
        setImages(data || []);
      } catch (err) {
        setError("이미지를 불러오지 못했어요.");
      } finally {
        setLoading(false);
      }
    };
    fetchImages();
  }, []);

  const toggleSelect = (imageId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) {
      setError("최소 1개 이상 선택해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      await submitOnboarding(Array.from(selectedIds));
      navigate("/projects");
    } catch (err) {
      setError("저장에 실패했어요. 다시 시도해주세요.");
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (window.confirm("나중에 마이페이지에서 다시 설정할 수 있어요. 건너뛸까요?")) {
      navigate("/projects");
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>이미지를 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>
          평소 본인의 그림체와 비슷한 이미지를 선택해주세요.
        </h1>
        <p className={styles.subtitle}>
          본인의 드로잉 스타일에 가까운 이미지 카테고리를 선택해주세요.
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.grid}>
          {images.map((img) => (
            <button
              key={img.id}
              className={`${styles.card} ${
                selectedIds.has(img.id) ? styles.selected : ""
              }`}
              onClick={() => toggleSelect(img.id)}
              type="button"
            >
              <div className={styles.cardImageWrapper}>
                <img
                  src={img.url}
                  alt={img.label || "이미지"}
                  className={styles.cardImage}
                  loading="lazy"
                />
                <div className={styles.cardOverlay}>
                  <span className={styles.cardLabel}>
                    {img.label || "카테고리 키워드"}
                  </span>
                </div>
                {selectedIds.has(img.id) && (
                  <div className={styles.checkBadge}>
                    <CheckIcon />
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        <button
          className={styles.submitBtn}
          onClick={handleSubmit}
          disabled={submitting || selectedIds.size === 0}
        >
          {submitting ? "저장 중..." : "다음으로"}
        </button>

        <button className={styles.skipBtn} onClick={handleSkip}>
          건너뛰기
        </button>
      </div>
    </div>
  );
};

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default OnboardingPage;