import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthHeader from "./AuthHeader";
import { TERMS } from "./termsContent";
import { agreeTerms as agreeTermsApi } from "./authApi";
import { useConsent } from "../../auth/ConsentContext";
import styles from "./TermsAgreement.module.css";

const initialAgreed = TERMS.reduce(
  (acc, t) => ({ ...acc, [t.key]: false }),
  {},
);

// consentMode=true → 로그인 상태(구글 가입/기존 회원)에서 약관 동의를 서버에 기록
const TermsAgreement = ({ consentMode = false }) => {
  const navigate = useNavigate();
  const consent = useConsent();
  const [agreed, setAgreed] = useState(initialAgreed);
  const [detail, setDetail] = useState(null); // 자세히 보기 모달에 띄울 약관 항목
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const allChecked = useMemo(() => TERMS.every((t) => agreed[t.key]), [agreed]);
  const requiredChecked = useMemo(
    () => TERMS.filter((t) => t.required).every((t) => agreed[t.key]),
    [agreed],
  );

  const toggleAll = () => {
    const next = !allChecked;
    setAgreed(TERMS.reduce((acc, t) => ({ ...acc, [t.key]: next }), {}));
  };

  const toggleOne = (key) => {
    setAgreed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleNext = async () => {
    if (!requiredChecked || submitting) return;
    if (!consentMode) {
      // 회원가입 플로우: 동의 내역을 회원가입 폼으로 전달
      navigate("/signup", { state: { agreements: agreed } });
      return;
    }
    // 로그인 상태(구글 가입/기존 회원): 약관 동의를 서버에 기록
    setSubmitting(true);
    setSubmitError("");
    try {
      await agreeTermsApi({
        agreeTerms: agreed.agreeTerms,
        agreePrivacy: agreed.agreePrivacy,
        agreeAge: agreed.agreeAge,
      });
      consent?.markAgreed();
      navigate("/projects");
    } catch (err) {
      const message =
        err.response?.data?.error?.message || "약관 동의 처리에 실패했어요.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleModalAgree = (agree) => {
    setAgreed((prev) => ({ ...prev, [detail.key]: agree }));
    setDetail(null);
  };

  return (
    <div className={styles.page}>
      <AuthHeader />
      <div className={styles.content}>
        <div className={styles.wrapper}>
          <div className={styles.section}>
            <h1 className={styles.title}>
              <span>DraWe</span> 이용약관 동의
            </h1>
            <p className={styles.sub}>
              DraWe 서비스 사용을 위해 정보 제공에 동의해주세요!
            </p>
          </div>

          <div className={styles.box}>
            <button type="button" className={styles.allRow} onClick={toggleAll}>
              <Checkbox checked={allChecked} />
              <span className={styles.allLabel}>전체 약관 동의</span>
            </button>

            <div className={styles.divider} />

            <ul className={styles.list}>
              {TERMS.map((t) => (
                <li key={t.key} className={styles.item}>
                  <button
                    type="button"
                    className={styles.itemCheck}
                    onClick={() => toggleOne(t.key)}
                  >
                    <Checkbox checked={agreed[t.key]} />
                    <span className={styles.itemLabel}>
                      {t.label}{" "}
                      <span
                        className={
                          t.required ? styles.required : styles.optional
                        }
                      >
                        ({t.required ? "필수" : "선택"})
                      </span>
                    </span>
                  </button>
                  <span className={styles.detailWrap}>
                    <button
                      type="button"
                      className={styles.detailBtn}
                      onClick={() => setDetail(t)}
                      aria-label="자세히 보기"
                    >
                      <ChevronRight />
                    </button>
                    <span className={styles.tooltip}>자세히 보기</span>
                  </span>
                </li>
              ))}
            </ul>

            {submitError && <p className={styles.submitError}>{submitError}</p>}

            <button
              type="button"
              className={styles.nextBtn}
              onClick={handleNext}
              disabled={!requiredChecked || submitting}
            >
              {submitting ? "처리 중..." : "다음으로"}
            </button>
          </div>
        </div>
      </div>

      {detail && (
        <div
          className={styles.modalOverlay}
          onClick={() => setDetail(null)}
          role="presentation"
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>{detail.modalTitle}</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setDetail(null)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <p className={styles.modalSubTitle}>
              {detail.label}{" "}
              <span
                className={detail.required ? styles.required : styles.optional}
              >
                ({detail.required ? "필수" : "선택"})
              </span>
            </p>
            <div className={styles.modalBody}>{detail.body}</div>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.disagreeBtn}
                onClick={() => handleModalAgree(false)}
              >
                동의안함
              </button>
              <button
                type="button"
                className={styles.agreeBtn}
                onClick={() => handleModalAgree(true)}
              >
                동의함
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Checkbox = ({ checked }) => (
  <span className={`${styles.checkbox} ${checked ? styles.checkboxOn : ""}`}>
    {checked && (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12.5L10 17.5L19 7.5"
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )}
  </span>
);

const ChevronRight = () => (
  <svg width="9" height="16" viewBox="0 0 9 16" fill="none">
    <path
      d="M1 1L8 8L1 15"
      stroke="#b5b5b5"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default TermsAgreement;
