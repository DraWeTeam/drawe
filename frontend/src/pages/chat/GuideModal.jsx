import { useState } from "react";
import { axisLabel } from "./guideLabels";
import AuthedImage from "./AuthedImage";
import styles from "./GuideModal.module.css";

// guide 서비스 에셋(SVG 도식) 공개 base. 미설정이면 도식 영역 자체를 숨김(빈 박스 금지).
const GUIDE_BASE = import.meta.env.VITE_GUIDE_PUBLIC_URL || "";
const assetUrl = (refId) =>
  GUIDE_BASE && refId ? `${GUIDE_BASE}/guide-asset/${refId}` : null;

// trend 첫 장 → 마지막 장의 difficulty_count 변화. 수치는 응답에 없으므로 여기서 계산(측정=사실).
function growthDelta(trend) {
  if (!trend || trend.length < 2) return null;
  const first = trend[0].difficulty_count || 0;
  const last = trend[trend.length - 1].difficulty_count || 0;
  if (first === 0 && last === 0) return null;
  const diff = last - first;
  const dir = diff < 0 ? "down" : diff > 0 ? "up" : "flat";
  const pct = first > 0 ? Math.round((Math.abs(diff) / first) * 100) : null;
  return { dir, pct };
}
// 성장 메시지 — 어려움을 '느낀 횟수'의 흐름만 사실대로(실력/평가 금지).
function deltaMessage(d) {
  if (!d) return "";
  if (d.dir === "down")
    return d.pct != null
      ? `처음 가이드를 받았을 때보다 어려움을 느낀 부분이 ${d.pct}% 줄었어요. 연습한 흐름이 그래프에 보여요.`
      : "처음보다 어려움을 느낀 부분이 줄었어요. 연습한 흐름이 그래프에 보여요.";
  if (d.dir === "up")
    return d.pct != null
      ? `최근에 어려움을 느낀 부분이 ${d.pct}% 늘었어요. 지금 구간을 조금 더 챙겨보면 좋아요.`
      : "최근에 어려움을 느낀 부분이 늘었어요. 지금 구간을 조금 더 챙겨보면 좋아요.";
  return "최근 어려움을 느낀 정도가 비슷하게 유지되고 있어요.";
}

// 섹션 헤더: "n. 제목". accent=true 면 주황(한 끗 포인트·성장 흐름).
const SectionTitle = ({ num, children, accent }) => (
  <h3 className={`${styles.sectionTitle} ${accent ? styles.accent : ""}`}>
    {num != null && <span className={styles.sectionNum}>{num}.</span>}
    {children}
  </h3>
);

// 한 끗 포인트 SVG 도식. 로드 실패/미설정이면 영역 자체를 숨긴다(빈 박스 금지).
const AssetSvg = ({ asset }) => {
  const [failed, setFailed] = useState(false);
  const url = asset && assetUrl(asset.ref_id);
  if (!url || failed) return null;
  return (
    <figure className={styles.assetFig}>
      <img
        className={styles.assetImg}
        src={url}
        alt={asset.label || "도식"}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {asset.caption && (
        <figcaption className={styles.assetCaption}>{asset.caption}</figcaption>
      )}
    </figure>
  );
};

// 추천 레퍼런스 썸네일: 번호(보드 순번) + 캡션.
const RefCard = ({ reference }) => {
  const [failed, setFailed] = useState(false);
  return (
    <figure className={styles.refCard}>
      <div className={styles.refThumb}>
        <span className={styles.refNum}>{reference.ordinal}</span>
        {failed ? (
          <div className={styles.refFallback} aria-hidden />
        ) : (
          <img
            className={styles.refImg}
            src={reference.url}
            alt={`참고 ${reference.ordinal}`}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <figcaption className={styles.refLabel}>
        참고 {reference.ordinal}
      </figcaption>
    </figure>
  );
};

// 레퍼런스 묶음 피드백 — 👍👎 시각 토글(주황) + 🔄 새로고침.
//   👍/👎: 선택 시 onFeedback(kind, refIds) 로 백엔드 전송(adoption_log). 같은 버튼 재클릭=해제(전송 안 함).
//   refIds 가 바뀌면(🔄 로 묶음 변경) 선택을 초기화한다.
const RefFeedback = ({ refIds, canRefresh, onFeedback, onRefresh }) => {
  const [sel, setSel] = useState(null);
  const refKey = (refIds || []).join(",");
  const [prevRefKey, setPrevRefKey] = useState(refKey);
  if (refKey !== prevRefKey) {
    setPrevRefKey(refKey);
    setSel(null);
  }

  const choose = (kind) => {
    const next = sel === kind ? null : kind; // 토글
    setSel(next);
    if (next && onFeedback) onFeedback(kind, refIds || []); // 선택 시에만 전송(해제는 로컬)
  };
  return (
    <div className={styles.refFeedback}>
      <button
        type="button"
        className={`${styles.fbBtn} ${sel === "up" ? styles.fbBtnActive : ""}`}
        aria-label="도움이 됐어요"
        aria-pressed={sel === "up"}
        onClick={() => choose("up")}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 10v11" />
          <path d="M14 9V5a2 2 0 0 0-2-2l-3 7v11h9a2 2 0 0 0 2-1.7l1-6A2 2 0 0 0 20 10z" />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.fbBtn} ${sel === "down" ? styles.fbBtnActive : ""}`}
        aria-label="별로예요"
        aria-pressed={sel === "down"}
        onClick={() => choose("down")}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 14V3" />
          <path d="M10 15v4a2 2 0 0 0 2 2l3-7V3H6a2 2 0 0 0-2 1.7l-1 6A2 2 0 0 0 5 14z" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.fbBtn}
        aria-label="다른 레퍼런스 보기"
        disabled={!canRefresh}
        onClick={() => onRefresh && onRefresh()}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
    </div>
  );
};

// 면적 차트(성장): trend [{index, difficulty_count, label}] → 부드러운 area + 델타 배지.
const GrowthChart = ({ trend, delta }) => {
  if (!trend || trend.length < 2) return null;
  const W = 520;
  const H = 150;
  const PAD = 8;
  const max = Math.max(1, ...trend.map((t) => t.difficulty_count || 0));
  const n = trend.length;
  const pts = trend.map((t, i) => {
    const x = PAD + (i / (n - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (t.difficulty_count || 0) / max) * (H - PAD * 2);
    return [x, y];
  });
  const line = pts
    .map((p, i, a) => {
      if (i === 0) return `M ${p[0]} ${p[1]}`;
      const prev = a[i - 1];
      const cx = (prev[0] + p[0]) / 2;
      return `C ${cx} ${prev[1]} ${cx} ${p[1]} ${p[0]} ${p[1]}`;
    })
    .join(" ");
  const area = `${line} L ${pts[n - 1][0]} ${H - PAD} L ${pts[0][0]} ${H - PAD} Z`;
  return (
    <div className={styles.chartWrap}>
      <p className={styles.chartTitle}>그림 한 장당 어려움을 느낀 횟수</p>
      <div className={styles.chartArea}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.chartSvg}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f2853f" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#f2853f" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#growthFill)" />
          <path
            d={line}
            fill="none"
            stroke="#ee6f2d"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
        {delta && delta.pct != null && delta.dir !== "flat" && (
          <span className={styles.deltaTag}>
            {delta.pct}% {delta.dir === "down" ? "감소" : "증가"}
          </span>
        )}
      </div>
    </div>
  );
};

const ChipRow = ({ label, axes }) => {
  if (!axes || axes.length === 0) return null;
  return (
    <div className={styles.chipRow}>
      <span className={styles.chipRowLabel}>{label}</span>
      {axes.map((a) => (
        <span key={a} className={styles.chip}>
          {axisLabel(a)}
        </span>
      ))}
    </div>
  );
};

const Growth = ({ growth }) => {
  if (!growth) return null;
  const trend = growth.trend || [];
  const hasChart = trend.length >= 2;
  const current = growth.chips?.current_stage_axes || [];
  const improving = growth.chips?.improving_axes || [];
  const delta = hasChart ? growthDelta(trend) : null;
  // 차트 있으면 trend로 계산한 변화 한 줄(= next_steps.note 와 중복 안 됨).
  const message = hasChart
    ? deltaMessage(delta)
    : growth.narration ||
      "처음으로 한 끗 가이드를 사용하셨어요! 가이드를 더 받을수록 어떤 어려움을 자주 겪는지 흐름으로 보여드려요.";
  return (
    <section className={styles.growth}>
      <SectionTitle accent>성장 흐름</SectionTitle>
      <div className={styles.growthBox}>
        {hasChart && <GrowthChart trend={trend} delta={delta} />}
        {message && (
          <p className={hasChart ? styles.growthMsg : styles.growthFirst}>
            {message}
          </p>
        )}
      </div>
      <ChipRow label="현재 그림 단계" axes={current} />
      <ChipRow label="최근에 덜 보이는 어려움" axes={improving} />
    </section>
  );
};

// coach 본문 — 이미지4 흐름:
// 인트로 → 1.추천 연습 → 2.한 끗 포인트 → 3.추천 레퍼런스(+피드백) → (보조 블록) → 4.앞으로 해야 할 것 → 성장 흐름
const Coach = ({ guide, references, drawingPreviewUrl, onRefFeedback }) => {
  const blocks = guide.blocks || [];
  const primary = blocks[0];
  const extra = blocks.slice(1);
  const next = guide.next_steps;
  // 레이아웃 분기(시안):
  //  - 반복 가이드(로드맵 연습 있음) → "추천 연습" 선행(이미지6).
  //  - 최초 가이드(연습 없음=콜드스타트) → "1.분석 / 2.읽히는 느낌" 선행(이미지5).
  const hasPractice = !!next?.focus_practice;
  // 이력 내레이션은 '한 번만' 상단에(중복 제거). note 없으면 synthesis 폴백.
  const intro = next?.note || guide.synthesis || "";
  // 레퍼런스 풀(🔄 새로고침용): 표시 중인 top-3(references, URL 보유) + 페이로드 전체 블록의 나머지 ref.
  //   URL 은 references[0].url 에서 base 를 떼어 합성 → GUIDE_BASE env 불일치와 무관하게 일관.
  const refBase = (() => {
    const u = (references || [])[0]?.url || "";
    const i = u.lastIndexOf("/image/");
    return i >= 0 ? u.slice(0, i) : "";
  })();
  const urlFor = (refId) => {
    const hit = (references || []).find((r) => r.refId === refId);
    return hit ? hit.url : `${refBase}/image/${refId}`;
  };
  const refPool = (() => {
    const seen = new Set();
    const pool = [];
    for (const r of references || []) {
      if (r.refId && !seen.has(r.refId)) {
        seen.add(r.refId);
        pool.push(r.refId);
      }
    }
    // URL base 를 못 구하면(references 비었음) 블록 ref 는 띄울 수 없으니 제외.
    if (refBase) {
      for (const b of blocks) {
        for (const rid of b.reference_ids || []) {
          if (rid && !seen.has(rid)) {
            seen.add(rid);
            pool.push(rid);
          }
        }
      }
    }
    return pool;
  })();
  const [refOffset, setRefOffset] = useState(0);
  const poolKey = refPool.join(",");
  const [prevPoolKey, setPrevPoolKey] = useState(poolKey);
  if (poolKey !== prevPoolKey) {
    setPrevPoolKey(poolKey);
    setRefOffset(0); // 가이드(풀)가 바뀌면 처음으로
  }
  const displayedRefs =
    refPool.length === 0
      ? []
      : Array.from({ length: Math.min(3, refPool.length) }, (_, i) => {
          const refId = refPool[(refOffset + i) % refPool.length];
          return { ordinal: i + 1, refId, url: urlFor(refId) };
        });
  const canRefresh = refPool.length > 3;
  const cycleRefs = () => setRefOffset((o) => (o + 3) % refPool.length);
  // 번호: 있는 섹션만 1,2,3… 연속 부여(빈 섹션은 번호 건너뜀).
  let num = 0;
  const goalShown = next && (next.next_goal_practice || next.next_goal);

  return (
    <>
      {/* 반복 레이아웃에서만 상단 이미지/인트로(최초 레이아웃은 '1.분석' 안으로 들어감) */}
      {hasPractice && drawingPreviewUrl && (
        <AuthedImage
          className={styles.userImg}
          src={drawingPreviewUrl}
          alt="첨부한 그림"
        />
      )}

      {hasPractice && intro && <p className={styles.intro}>{intro}</p>}

      {hasPractice && primary?.observation && (
        <p className={styles.lead}>
          {primary.observation}
          {primary.effect ? ` ${primary.effect}` : ""}
        </p>
      )}

      {/* 최초 가이드 — 1. 분석 (첨부 그림 + 관찰) */}
      {!hasPractice && primary?.observation && (
        <section className={styles.section}>
          <SectionTitle num={++num}>분석</SectionTitle>
          <div className={styles.analysisBox}>
            {drawingPreviewUrl && (
              <AuthedImage
                className={styles.analysisImg}
                src={drawingPreviewUrl}
                alt="첨부한 그림"
              />
            )}
            <p className={styles.bodyText}>{primary.observation}</p>
          </div>
        </section>
      )}

      {/* 최초 가이드 — 2. 읽히는 느낌 (effect) */}
      {!hasPractice && primary?.effect && (
        <section className={styles.section}>
          <SectionTitle num={++num}>읽히는 느낌</SectionTitle>
          <div className={styles.readBox}>
            <p className={styles.bodyText}>{primary.effect}</p>
          </div>
        </section>
      )}

      {/* 1. 추천 연습 — 로드맵 연습(focus_practice). 없으면 섹션 생략. */}
      {hasPractice && (
        <section className={styles.section}>
          <SectionTitle num={++num}>추천 연습</SectionTitle>
          <div className={styles.practiceBox}>
            <p className={styles.bodyText}>{next.focus_practice}</p>
          </div>
        </section>
      )}

      {/* 2. 한 끗 포인트 — direction + 도식 */}
      {primary && (primary.direction || primary.guide_asset) && (
        <section className={styles.section}>
          <SectionTitle num={++num} accent>
            한 끗 포인트
          </SectionTitle>
          <div className={styles.tipBox}>
            {primary.direction && (
              <p className={styles.tipText}>{primary.direction}</p>
            )}
            <AssetSvg asset={primary.guide_asset} />
          </div>
        </section>
      )}

      {/* 3. 추천 레퍼런스 (+ 피드백·새로고침) */}
      {displayedRefs.length > 0 && (
        <section className={styles.section}>
          <SectionTitle num={++num}>추천 레퍼런스</SectionTitle>
          <div className={styles.refGrid}>
            {displayedRefs.map((r) => (
              <RefCard key={r.refId} reference={r} />
            ))}
          </div>
          <RefFeedback
            refIds={displayedRefs.map((r) => r.refId)}
            canRefresh={canRefresh}
            onFeedback={onRefFeedback}
            onRefresh={cycleRefs}
          />
        </section>
      )}

      {/* 함께 보면 좋은 것 — 보조 초점(있을 때만, 가볍게) */}
      {extra.length > 0 && (
        <section className={styles.section}>
          <SectionTitle>함께 보면 좋은 것</SectionTitle>
          {extra.map((b, i) => (
            <p key={i} className={styles.extraLine}>
              <strong className={styles.extraAxis}>
                {axisLabel(b.sub_problem)}
              </strong>{" "}
              {b.direction || b.observation}
            </p>
          ))}
        </section>
      )}

      {/* 4. 앞으로 해야 할 것 — 다음 목표 카드만(note 는 상단으로 이동). */}
      {goalShown && (
        <section className={styles.nextSteps}>
          <SectionTitle num={++num}>앞으로 해야 할 것</SectionTitle>
          <div className={styles.nextGoal}>
            <span className={styles.goalBadge}>다음 목표</span>
            {next.next_goal && (
              <span className={styles.goalAxis}>
                {axisLabel(next.next_goal)}
              </span>
            )}
            {next.next_goal_practice && (
              <p className={styles.goalText}>{next.next_goal_practice}</p>
            )}
          </div>
        </section>
      )}

      {/* 성장 흐름 */}
      <Growth growth={guide.growth} />
    </>
  );
};

// 가이드 본문(로딩/에러/코치) — 모달·인라인 공용.
const GuideBody = ({
  loading,
  error,
  guide,
  references,
  drawingPreviewUrl,
  onRetry,
  onRefFeedback,
}) => (
  <div className={styles.body}>
    {loading && (
      <div className={styles.state}>
        <div className={styles.spinner} aria-hidden />
        <p className={styles.stateText}>그림을 살펴보고 있어요…</p>
      </div>
    )}
    {!loading && error && (
      <div className={styles.state}>
        <p className={styles.stateText}>
          가이드를 받아오지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
        {onRetry && (
          <button type="button" className={styles.retryBtn} onClick={onRetry}>
            다시 시도
          </button>
        )}
      </div>
    )}
    {!loading &&
      !error &&
      guide &&
      (guide.mode !== "coach" ? (
        <p className={styles.bodyText}>
          {guide.message ||
            "이 그림으로는 가이드를 만들기 어려웠어요. 조금 더 진행한 뒤 다시 시도해 주세요."}
        </p>
      ) : (
        <Coach
          guide={guide}
          references={references}
          drawingPreviewUrl={drawingPreviewUrl}
          onRefFeedback={onRefFeedback}
        />
      ))}
  </div>
);

// 인라인 가이드(채팅 왼쪽 패널 / 전체화면) — 와이어프레임 레이아웃. 떠 있는 모달이 아니라 좌측 영역을 채움.
//   onToggleFull 있으면 전체화면 토글 노출(isFull = 현재 전체화면 여부).
export const GuideContent = ({
  result,
  loading,
  error,
  drawingPreviewUrl,
  onClose,
  onRetry,
  onRefFeedback,
  onToggleFull,
  isFull,
}) => {
  const guide = result?.guide;
  const references = result?.references || [];
  const title = guide?.primary_focus
    ? `${axisLabel(guide.primary_focus)} 한 끗 가이드`
    : "한 끗 가이드";
  return (
    <div className={styles.inlinePanel}>
      <header className={styles.header}>
        <h2 className={styles.title}>{loading ? "한 끗 가이드" : title}</h2>
        <div className={styles.headerRight}>
          {onToggleFull && (
            <button
              type="button"
              className={styles.iconHeaderBtn}
              onClick={onToggleFull}
              aria-label={isFull ? "분할 보기" : "전체화면"}
              title={isFull ? "분할 보기" : "전체화면"}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {isFull ? (
                  <path d="M9 9H4M9 9V4M15 9h5M15 9V4M9 15H4M9 15v5M15 15h5M15 15v5" />
                ) : (
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
                )}
              </svg>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="닫기"
            >
              ×
            </button>
          )}
        </div>
      </header>
      <GuideBody
        loading={loading}
        error={error}
        guide={guide}
        references={references}
        drawingPreviewUrl={drawingPreviewUrl}
        onRetry={onRetry}
        onRefFeedback={onRefFeedback}
      />
    </div>
  );
};

const GuideModal = ({
  result,
  loading,
  error,
  drawingPreviewUrl,
  onClose,
  onRetry,
  onRefFeedback,
}) => {
  const guide = result?.guide;
  const references = result?.references || [];
  const title = guide?.primary_focus
    ? `${axisLabel(guide.primary_focus)} 한 끗 가이드`
    : "한 끗 가이드";

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="한 끗 가이드 결과"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{loading ? "한 끗 가이드" : title}</h2>
          <div className={styles.headerRight}>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </header>
        <GuideBody
          loading={loading}
          error={error}
          guide={guide}
          references={references}
          drawingPreviewUrl={drawingPreviewUrl}
          onRetry={onRetry}
          onRefFeedback={onRefFeedback}
        />
      </div>
    </div>
  );
};

export default GuideModal;
