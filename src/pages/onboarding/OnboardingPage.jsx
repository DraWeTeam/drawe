import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getOnboardingImages, submitOnboarding } from "./api";
import { track } from "../../analytics";
import styles from "./OnboardingPage.module.css";

const ONBOARDING_VERSION = "v1";

const OnboardingPage = () => {
  const navigate = useNavigate();
  const [images, setImages] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const sessionStartTime = useRef(Date.now());
  const lastSelectionTime = useRef(Date.now());
  const thresholdReached = useRef(false);
  const viewedIds = useRef(new Set());

  useEffect(() => {
    track('onboarding_style_started', {
      onboarding_version: ONBOARDING_VERSION,
    });
    const fetchImages = async () => {
      try {
        const data = await getOnboardingImages();
        setImages(data || []);
      } catch (err) {
        console.log(err);
        setError("이미지를 불러오지 못했어요.");
      } finally {
        setLoading(false);
      }
    };
    fetchImages();
  }, []);

  useEffect(() => {
    const fireSessionDropped = () => {
      if (completedOrSkipped.current) return;  // 정상 종료면 발화 안 함
      
      track('onboarding_style_session_dropped', {
        selected_count_at_drop: selectedCountRef.current,
        time_spent_sec: Math.floor((Date.now() - sessionStartTime.current) / 1000),
        onboarding_version: ONBOARDING_VERSION,
      });
    };
    
    // 브라우저 탭 닫기/새로고침
    window.addEventListener('beforeunload', fireSessionDropped);
    
    return () => {
      window.removeEventListener('beforeunload', fireSessionDropped);
      // React 네비게이션 (컴포넌트 unmount)
      fireSessionDropped();
    };
  }, []);

  const toggleSelect = (imageId) => {
    setError("");
    
    const image = images.find((img) => img.id === imageId);
    const wasSelected = selectedIds.has(imageId);
    const newCount = wasSelected ? selectedIds.size - 1 : selectedIds.size + 1;
    
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });

    if (wasSelected) {
    // 선택 해제
      track('onboarding_style_image_deselected', {
        image_id: imageId,
        image_tags: image?.tags?.join(',') || '',
        current_selected_count: newCount,
        onboarding_version: ONBOARDING_VERSION,
      });
    } else {
      // 새로 선택
      const position = images.findIndex((img) => img.id === imageId);
      track('onboarding_style_image_selected', {
        image_id: imageId,
        image_tags: image?.tags?.join(',') || '',
        image_position: position,
        selection_order: newCount,
        time_to_select_ms: Date.now() - lastSelectionTime.current,
        current_selected_count: newCount,
        onboarding_version: ONBOARDING_VERSION,
      });
      lastSelectionTime.current = Date.now();
      
      // 기준 도달 (1회만 발화)
      if (!thresholdReached.current && newCount >= SELECTION_THRESHOLD) {
        thresholdReached.current = true;
        track('onboarding_style_threshold_reached', {
          threshold_count: SELECTION_THRESHOLD,
          total_viewed_count: images.length,
          time_to_threshold_sec: Math.floor((Date.now() - sessionStartTime.current) / 1000),
          onboarding_version: ONBOARDING_VERSION,
        });
      }
    }
  };

  const handleSubmit = async () => {
    setError("");
    
    if (selectedIds.size === 0) {
      setError("최소 1개 이상 선택해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const finalIds = Array.from(selectedIds);
      await submitOnboarding(Array.from(selectedIds));
      completedOrSkipped.current = true; 
      track('onboarding_style_completed', {
        final_selected_count: finalIds.length,
        final_selected_image_ids: finalIds.join(','),
        total_time_sec: Math.floor((Date.now() - sessionStartTime.current) / 1000),
        onboarding_version: ONBOARDING_VERSION,
      });
      navigate("/projects");
    } catch (err) {
      console.log(err);
      setError("저장에 실패했어요. 다시 시도해주세요.");
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (
      window.confirm("나중에 마이페이지에서 다시 설정할 수 있어요. 건너뛸까요?")
    ) {
      completedOrSkipped.current = true;
      track('onboarding_style_skipped', {
        selected_count_at_skip: selectedIds.size,
        time_spent_sec: Math.floor((Date.now() - sessionStartTime.current) / 1000),
        skip_trigger: 'button',
        onboarding_version: ONBOARDING_VERSION,
      });
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
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default OnboardingPage;
