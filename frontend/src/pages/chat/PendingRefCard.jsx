import { useEffect, useRef, useState } from "react";
import AuthedImage from "./AuthedImage";
import styles from "./PendingRefCard.module.css";

const POLL_MS = 2500; // 폴링 간격
const MAX_POLLS = 28; // ~70초 후엔 조용히 폴백(도식이 이미 자리에 있음)

/**
 * '적합한 레퍼런스 생성 중' 카드. job 이 ready 되면 그 자리에서 이미지로 바뀐다.
 *
 * props
 *  - pending  : { sub_problem, job_id, message }  (guide.pending_references 의 한 항목)
 *  - pollJob  : (jobId) => Promise<{status, refId}>  (api.getRefJob 바인딩)
 *  - buildUrl : (refId) => string  (다른 레퍼런스와 *동일* 방식의 URL 합성기; GuideModal 의 assetUrl)
 *  - onResolved? : (subProblem, refId) => void  (필요 시 부모 상태에 끼워넣기용)
 */
const PendingRefCard = ({ pending, pollJob, buildUrl, onResolved }) => {
  const [state, setState] = useState({ status: "generating", refId: null });
  const timer = useRef(null);
  const tries = useRef(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      tries.current += 1;
      try {
        const r = await pollJob(pending.job_id);
        if (!alive) return;
        if (r.status === "ready" && r.refId) {
          setState({ status: "ready", refId: r.refId });
          onResolved?.(pending.sub_problem, r.refId);
          return; // 폴링 종료
        }
        if (r.status === "failed" || r.status === "unknown") {
          setState({ status: "failed", refId: null });
          return; // 폴링 종료 → 카드 숨김(도식 폴백 유지)
        }
      } catch {
        /* 일시 네트워크 오류 → 다음 폴에서 재시도 */
      }
      if (alive && tries.current < MAX_POLLS) {
        timer.current = setTimeout(tick, POLL_MS);
      } else if (alive) {
        setState({ status: "failed", refId: null }); // 타임아웃 → 조용히 폴백
      }
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
    // job_id 가 카드 1개를 고유 식별 — 바뀌면 새 폴링
  }, [pending.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.status === "failed") return null; // 실패/타임아웃 → 도식이 이미 보이므로 카드 제거

  if (state.status === "ready") {
    return (
      <div className={styles.card}>
        <div className={styles.imageWrap}>
          <AuthedImage
            src={buildUrl(state.refId)}
            alt="새로 생성된 참고 이미지"
            className={styles.image}
          />
          <span className={styles.aiBadge}>AI 예시</span>
        </div>
        <span className={styles.readyLabel}>맞춤 레퍼런스</span>
      </div>
    );
  }

  // generating
  return (
    <div className={`${styles.card} ${styles.pending}`} aria-busy="true">
      <div className={styles.imageWrap}>
        <span className={styles.spinner} aria-hidden="true" />
      </div>
      <span className={styles.pendingLabel}>
        {pending.message || "맞는 레퍼런스를 만들고 있어요"}
      </span>
    </div>
  );
};

export default PendingRefCard;
