import styles from "./GenerationSuggestModal.module.css";

/**
 * 생성 유도 모달 — 세션 싫어요가 3회에 도달(ReactionResponse.suggestGeneration=true)하면 노출.
 * "마음에 드는 레퍼런스가 없으면 직접 생성해보라"고 유도한다.
 * 닫기(둘 중 무엇이든) 시 onAck 로 generation-suggestion/ack 를 호출해 세션 카운터를 리셋한다.
 *
 * @param {() => void} onLater    - "다음에" — 그냥 닫기(+ack)
 * @param {() => void} onGenerate - "생성하러 가기" — 오른쪽 패널 '레퍼런스 생성' 모드로(+ack)
 */
const GenerationSuggestModal = ({ onLater, onGenerate }) => {
  return (
    <div className={styles.backdrop} onClick={onLater}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <span className={styles.iconWrap}>
          <SparkleIcon />
        </span>
        <h2 className={styles.title}>마음에 드는 레퍼런스가 없나요?</h2>
        <p className={styles.desc}>
          찾는 느낌의 레퍼런스가 부족하면, 원하는 장면을 직접 설명해
          <br />
          나만의 레퍼런스 이미지를 생성해볼 수 있어요.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.laterBtn} onClick={onLater}>
            다음에
          </button>
          <button
            type="button"
            className={styles.generateBtn}
            onClick={onGenerate}
          >
            레퍼런스 생성하러 가기
          </button>
        </div>
      </div>
    </div>
  );
};

const SparkleIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0l2.5 8.5L23 11l-8.5 2.5L12 22l-2.5-8.5L1 11l8.5-2.5z" />
  </svg>
);

export default GenerationSuggestModal;
