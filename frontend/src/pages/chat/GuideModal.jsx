import { useState } from "react";
import { axisLabel, growthMessage } from "./guideLabels";
import AuthedImage from "./AuthedImage";
import OverlayImage from "./OverlayImage";
import { ingestReference } from "../projects/api";
import { notifyArchiveChanged } from "../gallery/archiveEvents";
import styles from "./GuideModal.module.css";

// guide 서비스 에셋(SVG 도식) 공개 base. 미설정이면 도식 영역 자체를 숨김(빈 박스 금지).
const GUIDE_BASE = import.meta.env.VITE_GUIDE_PUBLIC_URL || "";
const assetUrl = (refId) =>
  GUIDE_BASE && refId ? `${GUIDE_BASE}/guide-asset/${refId}` : null;

// ④ 추천 레퍼런스 badge — fastapi reference_meta 원값 → 한글 라벨(라벨 정책은 여기서만 수정).
//   조합(최대 3): 출처(source_type, 필수) + 부위(region) + 변별 persona(있으면) / 없으면 category.
const REF_BADGE_LABELS = {
  source: {
    self_render: "3D 참조",
    museum: "미술 자료",
    ai_example: "AI 생성",
  },
  region: { full: "전신", head: "얼굴", hand: "손", foot: "발" },
  category: {
    action: "동작",
    locomotion: "이동",
    expressive: "표현",
    rest: "정지",
    other: "기타",
  },
  persona: {
    light: "빛",
    color: "색",
    mood: "분위기",
    composition: "구도",
    technique: "기법",
  },
};
const DISCRIMINATIVE_PERSONAS = [
  "light",
  "color",
  "mood",
  "composition",
  "technique",
];
// #4 §1 주요 키워드(114:15606) — 대그룹별 [의미, 예시] 키워드(image 250 원문에서 각 1 추출).
//   대그룹은 오렌지 뱃지, 의미·예시는 중립. 대그룹은 track_map(축→그룹) 결과(track.group)를 재사용.
const GROUP_KW = {
  형태: ["비례", "실루엣"], // 의미:기본 도형·실루엣·비례 / 예시:러프 스케치, 인체 비례
  구조: ["무게중심", "포즈"], // 의미:인체·원근·무게중심 / 예시:포즈, 골격, 투시
  표현: ["명암", "색감"], // 의미:명암·채색·디테일 / 예시:빛·그림자, 색감, 텍스처
  연출: ["구도", "무드"], // 의미:구도·분위기·서사 / 예시:시선 흐름, 무드
};
const refBadges = (ref) => {
  const out = [];
  const src = REF_BADGE_LABELS.source[ref?.sourceType];
  if (src) out.push(src);
  const reg = REF_BADGE_LABELS.region[ref?.region];
  if (reg) out.push(reg);
  const disc = (ref?.personas || []).find((p) =>
    DISCRIMINATIVE_PERSONAS.includes(p),
  );
  const third = disc
    ? REF_BADGE_LABELS.persona[disc]
    : REF_BADGE_LABELS.category[ref?.category];
  if (third) out.push(third);
  return out.slice(0, 3);
};
// ③ 추천 이유: badge(출처·부위·유형)가 못 담는 '연습 축과의 연결'을 한 문장으로 조립(비-LLM).
//   ref.axis(소속 블록 sub_problem) 중심 + 변별 persona(빛·색·분위기…) 있으면 우선 반영.
//   축·meta 결손이면 graceful — 최종 빈 문자열이면 문장 노드 자체를 안 만든다.
const REASON_SOURCE = {
  self_render: "3D 참조",
  museum: "미술 자료",
  ai_example: "AI 생성 예시",
};
const refReason = (ref) => {
  const ax = ref?.axis ? axisLabel(ref.axis) : "";
  const src = REASON_SOURCE[ref?.sourceType] || "";
  const disc = (ref?.personas || []).find((p) =>
    DISCRIMINATIVE_PERSONAS.includes(p),
  );
  const persona = disc ? REF_BADGE_LABELS.persona[disc] : "";
  if (ax && persona && src)
    return `'${ax}' 연습에 맞춰 ${persona} 표현이 담긴 ${src}예요.`;
  if (ax && src) return `'${ax}' 연습을 위해 고른 ${src}예요.`;
  if (ax) return `'${ax}' 연습을 위해 고른 참조예요.`;
  if (src) return `그림 연습에 참고할 ${src}예요.`;
  return "";
};

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

// ⑥ 5단계 커리큘럼 프로그레스 바(114:15701). 백엔드 track{group, stages[5], current_idx}만 소비 —
//   라벨·단계 정의는 프론트가 만들지 않는다(단일 소스=fastapi track_map.yaml). fill 은 current_idx 비율.
const TrackBar = ({ track }) => {
  const stages = track.stages || [];
  const cur = Math.max(0, Math.min(stages.length - 1, track.current_idx ?? 0));
  const pctOf = (i) =>
    stages.length > 1 ? (i / (stages.length - 1)) * 100 : 0;
  return (
    <div className={styles.trackWrap}>
      {track.group && (
        <p className={styles.trackGroup}>
          <span className={styles.trackGroupName}>{track.group}</span> 그룹
        </p>
      )}
      <div className={styles.trackTrack}>
        <span
          className={styles.trackFill}
          style={{ width: `${pctOf(cur)}%` }}
        />
        {stages.map((s, i) => (
          <span
            key={s}
            className={`${styles.trackNode} ${i <= cur ? styles.trackNodeOn : ""} ${i === cur ? styles.trackNodeCur : ""}`}
            style={{ left: `${pctOf(i)}%` }}
          />
        ))}
      </div>
      <div className={styles.trackLabels}>
        {stages.map((s, i) => (
          <span
            key={s}
            className={`${styles.trackLabel} ${i === cur ? styles.trackLabelCur : ""}`}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
};

// 추천 레퍼런스 카드: 이미지(좌) + 우측 제목. 시안 SCR-GUIDE-02 세로 스택.
//   추천 이유·키워드 badge 는 데이터 결손이라 이번 범위 아님(DOM 노드 자체를 만들지 않음).
//   ⑤ 아카이브 담기 — 썸네일 위 glass 버튼(114:15652). projectId 있을 때만 노출, addReference 재사용.
const RefCard = ({ reference, archived, onArchive }) => {
  const [failed, setFailed] = useState(false);
  const badges = refBadges(reference);
  const reason = refReason(reference);
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
        {onArchive && (
          <button
            type="button"
            className={styles.refArchiveBtn}
            data-archived={archived ? "" : undefined}
            onClick={onArchive}
            disabled={archived}
            aria-label={archived ? "아카이브에 담김" : "아카이브에 담기"}
            title={archived ? "담김" : "아카이브 담기"}
          >
            {archived ? <RefCheckIcon /> : <RefArchiveIcon />}
          </button>
        )}
      </div>
      <div className={styles.refInfo}>
        <p className={styles.refTitle}>추천 레퍼런스 {reference.ordinal}</p>
        {badges.length > 0 && (
          <div className={styles.refBadges}>
            {badges.map((bd) => (
              <span key={bd} className={styles.refBadge}>
                {bd}
              </span>
            ))}
          </div>
        )}
        {reason && (
          <p className={styles.refReason}>
            <span className={styles.refReasonLabel}>추천 이유</span>
            {reason}
          </p>
        )}
      </div>
    </figure>
  );
};

const RefArchiveIcon = () => (
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
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </svg>
);
const RefCheckIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

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

// ⑦ 면적 차트(성장): trend [{index, label(주 MM.DD), weekly_count}] → 주별 가이드 요청 횟수 곡선
//   (정본 114:15736). weekly_count 우선, 없으면 difficulty_count 폴백(하위호환). trend 는 백엔드가
//   활동 주≥임계일 때만 채워 보낸다(contract.py 게이트). 아니면 [] → 차트 자체가 안 뜸(graceful).
export const GrowthChart = ({ trend }) => {
  if (!trend || trend.length < 2) return null;
  const W = 520;
  const H = 150;
  const PAD = 8;
  const val = (t) => t.weekly_count ?? t.difficulty_count ?? 0;
  const max = Math.max(1, ...trend.map(val));
  const n = trend.length;
  const pts = trend.map((t, i) => {
    const x = PAD + (i / (n - 1)) * (W - PAD * 2);
    const y = PAD + (1 - val(t) / max) * (H - PAD * 2);
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
      <p className={styles.chartTitle}>주별 가이드 요청 횟수</p>
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
      {/* ⑦ X축 = 주(정본: 첫 주 … 이번 주 날짜). 라벨 있을 때만(구 데이터엔 없음). */}
      {trend.some((t) => t.label && /\d/.test(t.label)) && (
        <div className={styles.chartXAxis}>
          <span>{trend[0].label}</span>
          {n > 2 && <span>{trend[Math.floor((n - 1) / 2)].label}</span>}
          <span>{trend[n - 1].label}</span>
        </div>
      )}
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
  projectId,
}) => {
  const blocks = guide.blocks || [];
  const primary = blocks[0];
  const next = guide.next_steps;

  // ⑤ 아카이브 담기 — 코퍼스 레퍼런스(UUID)를 backend 가 인제스트(원본 fetch→Image→ProjectReference, 멱등).
  //   정직 처리: 성공 응답 뒤에만 '담김' 표시, 실패는 조용히 넘기지 않고 토스트로 알린다.
  const [archivedRefs, setArchivedRefs] = useState(() => new Set());
  const [archiveError, setArchiveError] = useState("");
  const handleArchive = async (reference) => {
    const refId = reference?.refId;
    if (!projectId || !refId || archivedRefs.has(refId)) return;
    try {
      await ingestReference(projectId, reference);
      setArchivedRefs((prev) => new Set(prev).add(refId));
      setArchiveError("");
      notifyArchiveChanged(); // /archive 라이브 갱신
    } catch (err) {
      setArchiveError(
        err.response?.data?.error?.message ||
          "레퍼런스를 담지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    }
  };
  // §1 타이틀: 요청일자 + 주요 키워드(114:15606). 정본: 대그룹(오렌지)+의미+예시 각 1(image 250).
  //   대그룹 = track.group(⑥ track_map). track 없으면(구가이드·미정의 축) 진단 축 라벨 폴백.
  const reqDate = fmtReqDate(createdAt);
  // 정본 목업: 본문 상단 큰 가이드 제목(축 라벨). 헤더는 "한 끗 가이드" 브레드크럼만.
  const axisTitle = guide.primary_focus
    ? axisLabel(guide.primary_focus)
    : "한 끗 가이드";
  const topKeywords = (() => {
    const grp = guide.next_steps?.track?.group;
    if (grp && GROUP_KW[grp]) {
      return [
        { text: grp, big: true },
        { text: GROUP_KW[grp][0] },
        { text: GROUP_KW[grp][1] },
      ];
    }
    const out = [];
    for (const sp of [
      guide.primary_focus,
      ...blocks.map((b) => b.sub_problem),
    ]) {
      if (sp && !out.includes(sp)) out.push(sp);
    }
    return out.slice(0, 3).map((sp) => ({ text: axisLabel(sp) }));
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
  // ④ badge 메타(source_type·region·personas·category)를 refId 로 병합 — references(ResolvedReference)가 원천.
  const refMetaById = Object.fromEntries(
    (references || []).filter((r) => r?.refId).map((r) => [r.refId, r]),
  );
  // ③ ref → 소속 블록의 축(sub_problem). references(shown_refs)는 블록 reference_ids 합집합이라 안정적.
  const axisByRefId = (() => {
    const m = {};
    for (const b of blocks) {
      for (const rid of b.reference_ids || []) {
        if (rid && !(rid in m)) m[rid] = b.sub_problem || guide.primary_focus;
      }
    }
    return m;
  })();
  const displayedRefs =
    refPool.length === 0
      ? []
      : Array.from({ length: Math.min(3, refPool.length) }, (_, i) => {
          const refId = refPool[(refOffset + i) % refPool.length];
          const m = refMetaById[refId] || {};
          return {
            ordinal: i + 1,
            refId,
            url: urlFor(refId),
            sourceType: m.sourceType,
            region: m.region,
            personas: m.personas,
            category: m.category,
            axis: axisByRefId[refId] || guide.primary_focus,
          };
        });
  const canRefresh = refPool.length > 3;
  const cycleRefs = () => setRefOffset((o) => (o + 3) % refPool.length);
  const hasGoal =
    next && (next.focus || next.next_goal || next.next_goal_practice);
  const hasChecklist = next && next.focus_practice;
  // ⑥ 5단계 커리큘럼 트랙(백엔드 track_map 조립 결과만 소비). 현재/다음 단계 badge 는 track 있으면
  //   정본 단계 라벨, 없으면(구가이드·미정의 축) 기존 축 라벨 폴백.
  const track =
    next && next.track && Array.isArray(next.track.stages) ? next.track : null;
  const hasTrack = !!(track && track.stages.length === 5);
  const curStage = hasTrack
    ? track.stages[track.current_idx]
    : next && next.focus
      ? axisLabel(next.focus)
      : null;
  const nextStage = hasTrack
    ? track.stages[track.current_idx + 1] || null
    : next && next.next_goal
      ? axisLabel(next.next_goal)
      : null;

  return (
    <>
      {/* 1. 타이틀 — 정본 목업: 큰 가이드 제목 + 요청일자 + 주요 키워드 */}
      <section className={styles.titleMeta}>
        <h2 className={styles.guideTitle}>{axisTitle}</h2>
        {reqDate && <p className={styles.reqDate}>요청일자 : {reqDate}</p>}
        {topKeywords.length > 0 && (
          <div className={styles.keywordRow}>
            <span className={styles.keywordLabel}>주요 키워드 :</span>
            {topKeywords.map((k) => (
              <span
                key={k.text}
                className={k.big ? styles.keywordBadge : styles.keywordBadgeSub}
              >
                {k.text}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 2. 현재 그림 분석 — 사용자 질문 bubble(request_text 있을 때) + 업로드 이미지 + 관찰/효과 */}
      {(requestText ||
        drawingPreviewUrl ||
        primary?.observation ||
        primary?.effect) && (
        <section className={styles.section}>
          <SectionTitle>현재 그림 분석</SectionTitle>
          <div className={styles.analysisBox}>
            {/* 사용자 질문 말풍선 — 업로드 이미지 위, 우측 정렬(채팅 사용자 버블). 그림을 가리지 않게 오버레이 안 함. */}
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

      {/* 3. 한 끗 포인트 — direction + 조건부 렌더(114:15593):
          (개선 요청) 업로드 이미지 위 ①② 번호 오버레이 / (이론 질문) guide_asset 전체 SVG(badge 없음). */}
      {primary &&
        (primary.direction || primary.guide_asset || guide.overlay) && (
          <section className={styles.section}>
            <SectionTitle accent>한 끗 포인트</SectionTitle>
            <div className={styles.tipBox}>
              {primary.direction && (
                <p className={styles.tipText}>{primary.direction}</p>
              )}
              {guide.overlay && drawingPreviewUrl ? (
                <OverlayImage
                  className={styles.assetImg}
                  src={drawingPreviewUrl}
                  overlay={guide.overlay}
                  alt="개선 포인트 오버레이"
                />
              ) : (
                <AssetSvg asset={primary.guide_asset} />
              )}
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
                <RefCard
                  key={r.refId}
                  reference={r}
                  archived={archivedRefs.has(r.refId)}
                  onArchive={projectId ? () => handleArchive(r) : undefined}
                />
              ))}
            </div>
            <RefFeedback
              refIds={displayedRefs.map((r) => r.refId)}
              canRefresh={canRefresh}
              onFeedback={onRefFeedback}
              onRefresh={cycleRefs}
            />
            {archiveError && (
              <p className={styles.archiveError} role="alert">
                {archiveError}
              </p>
            )}
          </div>
        </section>
      )}

      {/* 5. 앞으로 해야 할 것 — ⑥ 5단계 커리큘럼 프로그레스(track) + 현재/다음 단계 + 서술 + 체크리스트 */}
      {(hasGoal || hasChecklist || hasTrack) && (
        <section className={styles.nextSteps}>
          <SectionTitle>앞으로 해야 할 것</SectionTitle>
          <div className={styles.nextStepsBox}>
            {hasTrack && <TrackBar track={track} />}
            {(curStage || nextStage) && (
              <div className={styles.stageRow}>
                {curStage && (
                  <span className={styles.stageItem}>
                    <span className={styles.stageLabel}>현재 단계 :</span>
                    <span className={styles.stageBadge}>{curStage}</span>
                  </span>
                )}
                {nextStage && (
                  <span className={styles.stageItem}>
                    <span className={styles.stageLabel}>다음 단계 :</span>
                    <span className={styles.stageBadgeNext}>{nextStage}</span>
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
  projectId,
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
          projectId={projectId}
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
  projectId,
}) => {
  const guide = result?.guide;
  const references = result?.references || [];
  const createdAt = result?.createdAt || null;
  const requestText = result?.requestText || null;
  return (
    <div className={styles.inlinePanel}>
      <header className={styles.header}>
        <h2 className={styles.title}>한 끗 가이드</h2>
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
        projectId={projectId}
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
  projectId,
}) => {
  const guide = result?.guide;
  const references = result?.references || [];
  const createdAt = result?.createdAt || null;
  const requestText = result?.requestText || null;

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
          <h2 className={styles.title}>한 끗 가이드</h2>
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
          projectId={projectId}
        />
      </div>
    </div>
  );
};

export default GuideModal;
