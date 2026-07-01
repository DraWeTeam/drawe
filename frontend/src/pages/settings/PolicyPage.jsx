import { useNavigate } from "react-router-dom";
import { TERMS } from "../login/termsContent";
import styles from "./PolicyPage.module.css";

// 환경설정에서 진입하는 읽기 전용 약관/정책 뷰.
// 가입 동의 화면(TermsAgreement, consentMode)과 달리 체크박스/동의 버튼이 없다.
// 노출 대상: 이용약관 + 개인정보 수집·이용(개인정보처리방침). 만 14세 확인은 동의 항목이라 제외.
const POLICY_KEYS = ["agreeTerms", "agreePrivacy"];

const PolicyPage = () => {
  const navigate = useNavigate();
  const docs = TERMS.filter((t) => POLICY_KEYS.includes(t.key));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => navigate(-1)}
        >
          ← 뒤로
        </button>
        <h1 className={styles.title}>약관 및 정책</h1>
      </header>

      {docs.map((doc) => (
        <section key={doc.key} className={styles.doc}>
          <h2 className={styles.docTitle}>{doc.modalTitle}</h2>
          <pre className={styles.docBody}>{doc.body}</pre>
        </section>
      ))}
    </div>
  );
};

export default PolicyPage;
