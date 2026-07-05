import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AuthedImage from "../chat/AuthedImage";
import { axisLabel, growthMessage } from "../chat/guideLabels";
import GuideModal, { GrowthChart } from "../chat/GuideModal";
import GuideCollectionPanel from "../chat/GuideCollectionPanel";
import { getCompletedDetail } from "./api";
import { getGuides } from "../chat/api";
import styles from "./CompletedDetailPage.module.css";

const GROUP_TABS = ["전체", "형태", "구조", "표현", "연출"];
const TIMELINE_HEAD = 8; // 정본: 8개 초과 시 접고 '전체 보기'로 펼침

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}.${mm}.${dd}`;
};
const fmtMonthDay = (iso) => {
  const full = fmtDate(iso);
  return full ? full.slice(5) : "";
};

// 백엔드 weeklyTrend point{label,count} → GrowthChart trend{label,weekly_count}
const toTrend = (points) =>
  (points || []).map((p) => ({ label: p.label, weekly_count: p.count }));

const CompletedDetailPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState("전체");
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  // 모아보기 항목 클릭 → 해당 가이드 상세 GuideModal 팝업(리셋·네비게이션 없음).
  const [activeGuide, setActiveGuide] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const [d, g] = await Promise.all([
          getCompletedDetail(projectId),
          getGuides(projectId).catch(() => []),
        ]);
        if (!alive) return;
        setDetail(d);
        // getGuides(GuideResult[]) → 모아보기 카드 + GuideModal 소비 형태(BoardGuideChat 패턴).
        const list = Array.isArray(g) ? g : [];
        setGuides(
          list.map((gg, i) => ({
            _gid: `g-${i}`,
            guide: gg.guide,
            references: gg.references || [],
            guideTitle: axisLabel(gg.guide?.primary_focus) || "한 끗",
            guidePreview: gg.uploadUrl ?? null,
            uploadUrl: gg.uploadUrl ?? null,
            createdAt: gg.createdAt ?? null,
            requestText: gg.requestText ?? null, // ① 상세 §2 사용자 버블
          })),
        );
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const trendByGroup = useMemo(() => {
    const m = {};
    for (const tg of detail?.weeklyTrend || []) m[tg.group] = tg.points;
    return m;
  }, [detail]);

  // 버그3: TOP 레퍼런스 썸네일을 /image/{refId}(302→서명 S3)로 XHR 인증하면 실패한다.
  //   가이드의 resolved references 에 담긴 url(자체 인증되는 절대 경로)을 refId 로 매핑해 직접 로드.
  const refUrlById = useMemo(() => {
    const m = {};
    for (const g of guides)
      for (const r of g.references || [])
        if (r.refId && r.url && !(r.refId in m)) m[r.refId] = r.url;
    return m;
  }, [guides]);

  const summaryMsg = useMemo(() => {
    const s = detail?.summary;
    if (!s) return "";
    return growthMessage(
      {
        recurring_stat: {
          sub_problem: s.axisId,
          first_week_hits: s.firstWeekHits,
          last_week_hits: s.lastWeekHits,
        },
      },
      true,
    );
  }, [detail]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.stateBox}>불러오는 중…</div>
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className={styles.page}>
        <div className={styles.stateBox}>
          완성작 정보를 불러오지 못했어요.
          <br />
          <button
            type="button"
            className={styles.backLink}
            onClick={() => navigate("/gallery")}
          >
            완성작 갤러리로
          </button>
        </div>
      </div>
    );
  }

  const ov = detail.overview || {};
  const timeline = detail.timeline || [];
  const shownTimeline = timelineOpen
    ? timeline
    : timeline.slice(0, TIMELINE_HEAD);
  const trend = toTrend(trendByGroup[tab]);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.back}
          onClick={() => navigate("/gallery")}
          aria-label="뒤로"
        >
          ‹
        </button>
        <h1 className={styles.pageTitle}>{ov.projectName || "완성작"}</h1>
      </header>

      {/* 작품 개요 + 최근 30일 통계 */}
      <div className={styles.overviewRow}>
        <section className={styles.overviewCard}>
          <div className={styles.repImgBox}>
            {ov.representativeImageUrl ? (
              <AuthedImage
                className={styles.repImg}
                src={ov.representativeImageUrl}
                alt={ov.projectName}
              />
            ) : (
              <div className={styles.repImgEmpty} aria-hidden />
            )}
          </div>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>총 작업일</span>
              <span className={styles.statValue}>{ov.workDays ?? 0}일</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>가이드 요청</span>
              <span className={styles.statValue}>{ov.guideCount ?? 0}회</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>저장 레퍼런스</span>
              <span className={styles.statValue}>
                {ov.referenceCount ?? 0}개
              </span>
            </div>
          </div>
          {summaryMsg && (
            <div className={styles.summaryBox}>
              <p className={styles.summaryLabel}>한 줄 성장 요약</p>
              <p className={styles.summaryText}>{summaryMsg}</p>
            </div>
          )}
        </section>

        <section className={styles.statCard}>
          <h2 className={styles.sectionTitle}>최근 30일 통계</h2>
          <p className={styles.axisNote}>
            X: 최근 30일 · Y: 주별 가이드 요청 횟수
          </p>
          <div className={styles.tabs} role="tablist">
            {GROUP_TABS.map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={tab === g}
                className={`${styles.tab} ${tab === g ? styles.tabActive : ""}`}
                onClick={() => setTab(g)}
              >
                {g}
              </button>
            ))}
          </div>
          {trend.length >= 2 ? (
            <GrowthChart trend={trend} />
          ) : (
            <div className={styles.chartEmpty}>
              이 그룹의 추이 데이터가 아직 충분하지 않아요.
            </div>
          )}
          <div className={styles.chipRow}>
            <div className={styles.chipCol}>
              <p className={styles.chipHead}>반복되는 문제 TOP 3</p>
              <ol className={styles.rankList}>
                {(detail.recurringTop || []).map((ax, i) => (
                  <li key={ax + i} className={styles.rankItem}>
                    <span className={styles.rankNum}>{i + 1}</span>
                    {axisLabel(ax)}
                  </li>
                ))}
                {(detail.recurringTop || []).length === 0 && (
                  <li className={styles.rankEmpty}>아직 없어요</li>
                )}
              </ol>
            </div>
            <div className={styles.chipCol}>
              <p className={styles.chipHead}>개선된 항목</p>
              <ul className={styles.checkList}>
                {(detail.improvedItems || []).map((ax, i) => (
                  <li key={ax + i} className={styles.checkItem}>
                    ✓ {axisLabel(ax)}
                  </li>
                ))}
                {(detail.improvedItems || []).length === 0 && (
                  <li className={styles.rankEmpty}>아직 없어요</li>
                )}
              </ul>
            </div>
          </div>
        </section>
      </div>

      {/* 성장 타임라인 */}
      {timeline.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>성장 타임라인</h2>
            {timeline.length > TIMELINE_HEAD && (
              <button
                type="button"
                className={styles.moreLink}
                onClick={() => setTimelineOpen((v) => !v)}
              >
                {timelineOpen ? "접기" : "전체 보기"}
              </button>
            )}
          </div>
          <div className={styles.timeline}>
            {shownTimeline.map((ev, i) => (
              <div key={i} className={styles.tlNode}>
                <span className={styles.tlDot} data-type={ev.type} />
                <span className={styles.tlDate}>{fmtMonthDay(ev.date)}</span>
                <span className={styles.tlLabel}>
                  {ev.type === "guide" ? axisLabel(ev.label) : ev.label}
                </span>
                <span className={styles.tlThumb}>
                  {ev.thumbUrl ? (
                    <AuthedImage
                      className={styles.tlThumbImg}
                      src={ev.thumbUrl}
                      alt=""
                    />
                  ) : (
                    <span className={styles.tlThumbEmpty} aria-hidden />
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 드로잉 과정 갤러리 */}
      {(detail.processGallery || []).length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>드로잉 과정 갤러리</h2>
          <div className={styles.processGrid}>
            {detail.processGallery.map((p, i) => (
              <div key={i} className={styles.processCard}>
                <span className={styles.processThumb}>
                  <AuthedImage
                    className={styles.processImg}
                    src={p.thumbUrl}
                    alt={p.label}
                  />
                </span>
                <span className={styles.processLabel}>{p.label}</span>
                <span className={styles.processDate}>{fmtDate(p.date)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 한 끗 가이드 모아보기 (인라인 프리뷰 + 전체보기 오버레이) */}
      {guides.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>한 끗 가이드 모아보기</h2>
            <button
              type="button"
              className={styles.moreLink}
              onClick={() => setCollectionOpen(true)}
            >
              전체 보기
            </button>
          </div>
          <div className={styles.guidePreviewList}>
            {guides.slice(0, 4).map((g, i) => {
              const grp = g.guide?.next_steps?.track?.group;
              return (
                <button
                  key={g._gid ?? i}
                  type="button"
                  className={styles.guideRow}
                  onClick={() => setCollectionOpen(true)}
                >
                  <span className={styles.guideRowTitle}>
                    {axisLabel(g.guide?.primary_focus) || "한 끗"}
                  </span>
                  {grp && <span className={styles.guideRowGroup}>{grp}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 가장 많이 참고한 레퍼런스 */}
      {(detail.topReferences || []).length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>가장 많이 참고한 레퍼런스</h2>
          <div className={styles.refList}>
            {detail.topReferences.map((r, i) => (
              <div key={r.refId ?? i} className={styles.refItem}>
                <span className={styles.refRank}>{i + 1}</span>
                <span className={styles.refThumb}>
                  <AuthedImage
                    className={styles.refThumbImg}
                    src={refUrlById[r.refId] || r.url}
                    alt=""
                  />
                </span>
                <span className={styles.refCount}>참고 {r.count}회</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 질문 성장 과정 */}
      {(detail.questionGrowth || []).length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>질문 성장 과정</h2>
          <div className={styles.qGrowth}>
            {detail.questionGrowth.map((q, i) => (
              <div key={i} className={styles.qRow}>
                <span className={styles.qPhase}>
                  <span className={styles.qPhaseName}>{q.phase}</span>
                  <span className={styles.qDate}>{fmtMonthDay(q.date)}</span>
                </span>
                <span className={styles.qBubble}>{q.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 모아보기 오버레이 — absolute 패널이 온전한 크기로 뜨도록 fixed 호스트 제공(버그2 포지셔닝). */}
      {collectionOpen && (
        <div className={styles.panelHost}>
          <GuideCollectionPanel
            guides={guides}
            onClose={() => setCollectionOpen(false)}
            onCardClick={(g) => {
              // 정본: 항목 클릭 → 해당 가이드 상세 팝업(GuideModal). 화면 리셋·네비게이션 없음.
              setCollectionOpen(false);
              setActiveGuide(g);
            }}
          />
        </div>
      )}

      {/* 가이드 상세 팝업(GuideModal 재사용) — 닫으면 완성작 상세 그대로 유지. */}
      {activeGuide && (
        <GuideModal
          result={activeGuide}
          drawingPreviewUrl={activeGuide.uploadUrl}
          onClose={() => setActiveGuide(null)}
          onRefFeedback={() => {}}
          projectId={projectId}
        />
      )}
    </div>
  );
};

export default CompletedDetailPage;
