import { useState } from "react";
import styles from "./GuidePanel.module.css";
import { labelOf } from "./guideLabels";
import { referenceImageUrl, guideAssetUrl } from "./guideApi";

/**
 * GuidePanel — 좌측 패널에 뜨는 "한 끗 가이드" 전체 화면.
 *
 * 채팅의 가이드 카드를 누르면 레퍼런스 보드 자리에 이 패널이 뜬다(5.png / 풀화면).
 * 섹션: 1.분석 · 2.읽히는 느낌 · 3.한 끗 포인트(도식) · 4.추천 레퍼런스 · 5.앞으로 해야 할 것 · 성장 흐름.
 *
 * Props:
 *  - guide: 정규화된 가이드 데이터(ChatPage extractGuide 참고)
 *  - growth: 로드맵 응답(undefined=불러오는 중, null=미제공, object=데이터)
 *  - onClose, onReact(refId, kind|null)
 */
const GuidePanel = ({ guide, growth, onClose, onReact }) => {
  const [reactions, setReactions] = useState({});

  if (!guide) return null;

  const {
    title,
    focusLabel,
    imageUrl,
    observation,
    effect,
    direction,
    guideAsset,
    references = [],
    nextGoal,
  } = guide;

  const heading = `${title || focusLabel || ""} 한 끗 가이드`.trim();
  const assetSrc = guideAsset ? guideAssetUrl(guideAsset.refId) : null;

  const react = (refId, kind) => {
    const next = reactions[refId] === kind ? null : kind; // 같은 버튼 재클릭=취소
    setReactions((r) => ({ ...r, [refId]: next }));
    onReact?.(refId, next);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.heading}>{heading}</h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="닫기"
        >
          <CloseIcon />
        </button>
      </div>

      <div className={styles.scroll}>
        {/* 1. 분석 */}
        <Section n="1. 분석">
          <div className={styles.analysis}>
            <div className={styles.thumb}>
              {imageUrl && <img src={imageUrl} alt="업로드 그림" />}
            </div>
            <p className={styles.lead}>
              {observation || "관찰 내용이 여기 표시됩니다."}
            </p>
          </div>
        </Section>

        {/* 2. 읽히는 느낌 */}
        <Section n="2. 읽히는 느낌">
          <div className={styles.card}>
            <p className={styles.lead}>
              {effect || "읽히는 느낌이 여기 표시됩니다."}
            </p>
          </div>
        </Section>

        {/* 3. 한 끗 포인트 */}
        <Section n="3. 한 끗 포인트" accent>
          <div className={`${styles.card} ${styles.accentCard}`}>
            <p className={styles.lead}>
              {direction || "지금 해볼 실험이 여기 표시됩니다."}
            </p>
            {assetSrc && (
              <figure className={styles.asset}>
                <img
                  src={assetSrc}
                  alt={guideAsset?.label || "구축 가이드 도식"}
                  loading="lazy"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
                {guideAsset?.caption && (
                  <figcaption className={styles.cap}>
                    {guideAsset.caption}
                  </figcaption>
                )}
              </figure>
            )}
          </div>
        </Section>

        {/* 4. 추천 레퍼런스 */}
        <Section n="4. 추천 레퍼런스">
          <div className={styles.card}>
            <div className={styles.refs}>
              {references.length ? (
                references.slice(0, 3).map((ref, i) => {
                  const src = referenceImageUrl(ref);
                  const rid = ref.id ?? i;
                  return (
                    <div className={styles.refCard} key={rid}>
                      <div className={styles.refImg}>
                        {src ? <img src={src} alt="" loading="lazy" /> : "🖼"}
                      </div>
                      <div className={styles.refMeta}>
                        <span className={styles.refIndex}>{i + 1}</span>
                        <span className={styles.refLabel}>레퍼런스</span>
                        <span className={styles.refReact}>
                          <button
                            type="button"
                            className={
                              reactions[rid] === "like" ? styles.reactOn : ""
                            }
                            onClick={() => react(rid, "like")}
                            title="도움돼요"
                          >
                            👍
                          </button>
                          <button
                            type="button"
                            className={
                              reactions[rid] === "dislike" ? styles.reactOn : ""
                            }
                            onClick={() => react(rid, "dislike")}
                            title="별로예요"
                          >
                            👎
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className={styles.refEmpty}>
                  레퍼런스가 아직 없어요.
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* 5. 앞으로 해야 할 것 */}
        <Section n="5. 앞으로 해야 할 것">
          <div className={styles.card}>
            {nextGoal ? (
              <>
                <div className={styles.goal}>
                  <span className={styles.goalChip}>다음 목표</span>
                  <span className={styles.goalName}>{nextGoal.label}</span>
                </div>
                {nextGoal.practice && (
                  <p className={styles.lead}>{nextGoal.practice}</p>
                )}
              </>
            ) : (
              <p className={`${styles.lead} ${styles.muted}`}>
                아직 다음 목표가 정해지지 않았어요.
              </p>
            )}
          </div>
        </Section>

        {/* 성장 흐름 */}
        {growth !== null && (
          <Section n="성장 흐름" accent>
            <Growth growth={growth} />
          </Section>
        )}
      </div>
    </div>
  );
};

const Section = ({ n, accent, children }) => (
  <div className={styles.sec}>
    <span className={`${styles.secLabel} ${accent ? styles.secAccent : ""}`}>
      {n}
    </span>
    {children}
  </div>
);

/* ── 성장 흐름 (/roadmap) ── */
const Growth = ({ growth }) => {
  if (growth === undefined) {
    return <div className={`${styles.lead} ${styles.muted}`}>성장 흐름 불러오는 중…</div>;
  }
  const tl = (growth.timeline || []).map((t) => t.flagged_count ?? 0);
  const current =
    growth.current && growth.current.sub_problem
      ? [labelOf(growth.current.sub_problem)]
      : [];

  if (tl.length < 3) {
    return (
      <div className={styles.cream}>
        <div className={styles.cold}>
          처음으로 한 끗 가이드를 사용하셨어요!
          <br />몇 번 더 사용하면 어떤 어려움을 가장 많이 겪는지 보여드릴게요.
        </div>
        <StageRow k="현재 그림 단계" tags={current} />
      </div>
    );
  }

  const first = tl[0] || 0;
  const last = tl[tl.length - 1] || 0;
  const pct = first > 0 ? Math.round(((first - last) / first) * 100) : 0;

  return (
    <div className={styles.cream}>
      <div className={styles.chartBox}>
        <div className={styles.chartTitle}>그림 한 장당 어려움을 느낀 횟수</div>
        <Sparkline vals={tl} />
      </div>
      <div className={styles.note}>
        처음 가이드를 요청했을 때보다 어려움을 보이는 부분이{" "}
        <b>{pct >= 0 ? `${pct}% 감소` : `${Math.abs(pct)}% 증가`}</b>했어요!
      </div>
      <StageRow k="현재 그림 단계" tags={current} />
    </div>
  );
};

const StageRow = ({ k, tags }) => {
  const list = tags.length ? tags : ["—"];
  return (
    <div className={styles.stageRow}>
      <span className={styles.stageK}>{k}</span>
      {list.map((t, i) => (
        <span className={styles.stageTag} key={i}>
          {t}
        </span>
      ))}
    </div>
  );
};

const Sparkline = ({ vals }) => {
  const w = 360;
  const h = 90;
  const pad = 4;
  const max = Math.max(...vals, 1);
  const n = vals.length;
  const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(n - 1, 1);
  const y = (v) => pad + (h - 2 * pad) * (1 - v / max);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${pad},${h} L` + pts.join(" L") + ` L${w - pad},${h} Z`;
  const line = "M" + pts.join(" L");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height="100"
      preserveAspectRatio="none"
      style={{ marginTop: 8 }}
    >
      <defs>
        <linearGradient id="guideSpark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF8534" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#FF8534" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#guideSpark)" />
      <path
        d={line}
        fill="none"
        stroke="#FF8534"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

const CloseIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M1.4 14L0 12.6L5.6 7L0 1.4L1.4 0L7 5.6L12.6 0L14 1.4L8.4 7L14 12.6L12.6 14L7 8.4L1.4 14Z"
      fill="currentColor"
    />
  </svg>
);

export default GuidePanel;
