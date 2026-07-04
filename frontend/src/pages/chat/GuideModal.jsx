import { useState } from "react";
import { axisLabel, growthMessage } from "./guideLabels";
import AuthedImage from "./AuthedImage";
import OverlayImage from "./OverlayImage";
import styles from "./GuideModal.module.css";

// guide 서비스 에셋(SVG 도식) 공개 base. 미설정이면 도식 영역 자체를 숨김(빈 박스 금지).
const GUIDE_BASE = import.meta.env.VITE_GUIDE_PUBLIC_URL || "";
const assetUrl = (refId) =>
  GUIDE_BASE && refId ? `${GUIDE_BASE}/guide-asset/${refId}` : null;

// ★성장 서술의 단일 소스는 백엔드다(growth.delta_note/trend). 프론트가 trend 로 %를 재계산하던
//   growthDelta/deltaMessage("처음 받았을 때보다 200%…")는 제거 — 이력<N 이면 백엔드가 trend/delta 를
//   아예 안 보내므로(contract.py 임계), 프론트는 '받은 것만' 렌더한다. 이중 게이트·% 노이즈 제거.

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

// 추천 레퍼런스 카드: 이미지(좌) + 우측 제목. 시안 SCR-GUIDE-02 세로 스택.
//   추천 이유·키워드 badge 는 데이터 결손이라 이번 범위 아님(DOM 노드 자체를 만들지 않음).
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
            alt={`추천 레퍼런스 ${reference.ordinal}`}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className={styles.refInfo}>
        <p className={styles.refTitle}>추천 레퍼런스 {reference.ordinal}</p>
      </div>
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

// 면적 차트(성장): trend [{index, difficulty_count, label}] → 부드러운 area.
//   trend 는 백엔드가 이력≥N 일 때만 채워 보낸다(contract.py 임계). 아니면 [] → 차트 자체가 안 뜸.
const GrowthChart = ({ trend }) => {
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
              <stop offset="0%" stopColor="#ff8534" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#ff8534" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#growthFill)" />
          <path
            d={line}
            fill="none"
            stroke="#ff8534"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
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
  const hasChart = trend.length > 0; // 백엔드가 준 것만(이력<N 이면 trend=[] → 차트·% 미발화)
  const current = growth.chips?.current_stage_axes || [];
  const improving = growth.chips?.improving_axes || [];
  // 성장 메시지: 화면·PDF 공용 growthMessage(guideLabels)로 조립 — rstat(recurring_stat)과
  //   delta(delta_note)를 한 문형으로 잇고, delta 없으면 narration 폴백(note 경로 보존).
  const message = growthMessage(growth, hasChart);
  return (
    <section className={styles.growth}>
      <SectionTitle accent>성장 흐름</SectionTitle>
      <div className={styles.growthBox}>
        {hasChart && <GrowthChart trend={trend} />}
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

// 요청일자 표기(시안 §1): ISO/Instant 문자열 → "YYYY.MM.DD.".
const fmtReqDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}.`;
};

// coach 본문 — 시안 SCR-GUIDE-03 7섹션(단일 구조, hasPractice 분기 없음):
//   1.타이틀 → 2.현재 그림 분석 → 3.한 끗 포인트 → 4.추천 레퍼런스 → 5.앞으로 해야 할 것 → 6.성장 흐름 → 7.피드백
const Coach = ({
  guide,
  references,
  drawingPreviewUrl,
  onRefFeedback,
  createdAt,
  requestText,
  onGuideFeedback,
  guideFeedback,
}) => {
  const blocks = guide.blocks || [];
  const primary = blocks[0];
  const next = guide.next_steps;
  // §1 타이틀: 요청일자 + 주요 키워드(진단된 축 = primary + 보조 블록, dedupe 후 최대 3).
  const reqDate = fmtReqDate(createdAt);
  const topKeywords = (() => {
    const out = [];
    for (const sp of [
      guide.primary_focus,
      ...blocks.map((b) => b.sub_problem),
    ]) {
      if (sp && !out.includes(sp)) out.push(sp);
    }
    return out.slice(0, 3);
  })();
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
  const hasGoal =
    next && (next.focus || next.next_goal || next.next_goal_practice);
  const hasChecklist = next && next.focus_practice;

  return (
    <>
      {/* 1. 타이틀 — 요청일자 + 주요 키워드(제목은 헤더 타이틀에 있음) */}
      {(reqDate || topKeywords.length > 0) && (
        <section className={styles.titleMeta}>
          {reqDate && <p className={styles.reqDate}>요청일자 : {reqDate}</p>}
          {topKeywords.length > 0 && (
            <div className={styles.keywordRow}>
              <span className={styles.keywordLabel}>주요 키워드 :</span>
              {topKeywords.map((k) => (
                <span key={k} className={styles.keywordBadge}>
                  {axisLabel(k)}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 2. 현재 그림 분석 — 사용자 질문 bubble(request_text 있을 때) + 업로드 이미지 + 관찰/효과 */}
      {(requestText ||
        drawingPreviewUrl ||
        primary?.observation ||
        primary?.effect) && (
        <section className={styles.section}>
          <SectionTitle>현재 그림 분석</SectionTitle>
          <div className={styles.analysisBox}>
            {requestText && (
              <p className={styles.userQuestion}>{requestText}</p>
            )}
            {drawingPreviewUrl && (
              <AuthedImage
                className={styles.analysisImg}
                src={drawingPreviewUrl}
                alt="첨부한 그림"
              />
            )}
            {(primary?.observation || primary?.effect) && (
              <div className={styles.analysisFindings}>
                <p className={styles.findingTitle}>AI가 발견한 문제</p>
                {primary?.observation && (
                  <p className={styles.findingText}>{primary.observation}</p>
                )}
                {primary?.effect && (
                  <p className={styles.findingText}>{primary.effect}</p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 3. 한 끗 포인트 — direction + 도식 [지금 바로 수정하기 hidden] */}
      {primary && (primary.direction || primary.guide_asset) && (
        <section className={styles.section}>
          <SectionTitle accent>한 끗 포인트</SectionTitle>
          <div className={styles.tipBox}>
            {primary.direction && (
              <p className={styles.tipText}>{primary.direction}</p>
            )}
            <AssetSvg asset={primary.guide_asset} />
          </div>
        </section>
      )}

      {/* 4. 추천 레퍼런스 (+ 피드백·새로고침) */}
      {displayedRefs.length > 0 && (
        <section className={styles.section}>
          <SectionTitle>추천 레퍼런스</SectionTitle>
          <div className={styles.refBoard}>
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
          </div>
        </section>
      )}

      {/* 5. 앞으로 해야 할 것 — [5단계 프로그레스 미생성: 필드 결손·키스톤 의존, Wave 3] + 현재/다음 단계 + 서술 + 체크리스트 */}
      {(hasGoal || hasChecklist) && (
        <section className={styles.nextSteps}>
          <SectionTitle>앞으로 해야 할 것</SectionTitle>
          <div className={styles.nextStepsBox}>
            {(next.focus || next.next_goal) && (
              <div className={styles.stageRow}>
                {next.focus && (
                  <span className={styles.stageItem}>
                    <span className={styles.stageLabel}>현재 단계 :</span>
                    <span className={styles.stageBadge}>
                      {axisLabel(next.focus)}
                    </span>
                  </span>
                )}
                {next.next_goal && (
                  <span className={styles.stageItem}>
                    <span className={styles.stageLabel}>다음 단계 :</span>
                    <span className={styles.stageBadgeNext}>
                      {axisLabel(next.next_goal)}
                    </span>
                  </span>
                )}
              </div>
            )}
            {next.next_goal_practice && (
              <p className={styles.goalText}>{next.next_goal_practice}</p>
            )}
            {next.focus_practice && (
              <div className={styles.checklist}>
                <p className={styles.checklistTitle}>
                  다음 그림에서 체크해보세요
                </p>
                <div className={styles.checkItem}>
                  <span className={styles.checkbox} aria-hidden />
                  <span className={styles.checkText}>
                    {next.focus_practice}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 6. 성장 흐름 */}
      <Growth growth={guide.growth} />

      {/* 7. 피드백 — 가이드 도움 여부(chip 2). 핸들러 없으면 미렌더. */}
      {onGuideFeedback && (
        <section className={styles.section}>
          <div className={styles.fbCard}>
            <p className={styles.fbQuestion}>이 가이드가 도움이 되었나요?</p>
            <div className={styles.guideFb}>
              <button
                type="button"
                className={`${styles.fbChip} ${guideFeedback === "up" ? styles.fbChipActive : ""}`}
                aria-pressed={guideFeedback === "up"}
                onClick={() => onGuideFeedback("up")}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M7 10v11" />
                  <path d="M14 9V5a2 2 0 0 0-2-2l-3 7v11h9a2 2 0 0 0 2-1.7l1-6A2 2 0 0 0 20 10z" />
                </svg>
                도움돼요
              </button>
              <button
                type="button"
                className={`${styles.fbChip} ${guideFeedback === "down" ? styles.fbChipActive : ""}`}
                aria-pressed={guideFeedback === "down"}
                onClick={() => onGuideFeedback("down")}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M17 14V3" />
                  <path d="M10 15v4a2 2 0 0 0 2 2l3-7V3H6a2 2 0 0 0-2 1.7l-1 6A2 2 0 0 0 5 14z" />
                </svg>
                아쉬워요
              </button>
            </div>
          </div>
        </section>
      )}
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
  createdAt,
  requestText,
  onGuideFeedback,
  guideFeedback,
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
          createdAt={createdAt}
          requestText={requestText}
          onGuideFeedback={onGuideFeedback}
          guideFeedback={guideFeedback}
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
  onGuideFeedback,
  guideFeedback,
  onToggleFull,
  isFull,
}) => {
  const guide = result?.guide;
  const references = result?.references || [];
  const createdAt = result?.createdAt || null;
  const requestText = result?.requestText || null;
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
        createdAt={createdAt}
        requestText={requestText}
        onGuideFeedback={onGuideFeedback}
        guideFeedback={guideFeedback}
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
  const createdAt = result?.createdAt || null;
  const requestText = result?.requestText || null;
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
          createdAt={createdAt}
          requestText={requestText}
        />
      </div>
    </div>
  );
};

export default GuideModal;
