import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AuthedImage from "../chat/AuthedImage";
import { axisLabel, growthMessage } from "../chat/guideLabels";
import GuideModal, { GrowthChart } from "../chat/GuideModal";
import GuideCollectionPanel from "../chat/GuideCollectionPanel";
import { getCompletedDetail } from "./api";
import { getGuides } from "../chat/api";
import { updateProject } from "../projects/api";
import { downloadImage } from "./download";
import { track } from "../../analytics";
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

// 요약 지표 아이콘(정본: 주황 라인 아이콘) — 폴더/문서/아카이브
const IconFolder = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#ff8534"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  </svg>
);
const IconDoc = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#ff8534"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 3h8l4 4v14a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0V3z" />
    <path d="M14 3v4h4" />
    <path d="M8 12h8M8 16h6" />
  </svg>
);
const IconArchive = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#ff8534"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M10 12h4" />
  </svg>
);

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
  // 더보기(⋯) 메뉴 + 제목 인라인 수정(정본 [동작] 더보기·작품 정보 수정).
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  // TOP 레퍼런스 항목 클릭 → 원본 크게 보기(라이트박스). SCR-ARCH-05 는 reference 객체를
  //   nav state 로 받는 구조라 refId URL 만으론 못 열어(→chat 리다이렉트) 라이트박스로 상세 확인.
  const [lightboxRef, setLightboxRef] = useState(null);
  // 정본: 반복/개선 항목 3개 표시 + '더 많은 항목 보기 >'로 펼침(백엔드는 최대 6 반환).
  const [chipOpen, setChipOpen] = useState(false);
  // 모아보기 필터 탭(정본: 전체/형태/구조/표현/연출) — 가이드 track group 으로 필터.
  const [guideTab, setGuideTab] = useState("전체");

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
        setName(d?.overview?.projectName || "");
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

  // [트래킹] 완성작 상세 진입 후 2초 이상 머물면 archive_gallery_item_viewed 1회 전송.
  useEffect(() => {
    if (!detail) return undefined;
    const cwId = /\/images\/(\d+)/.exec(
      detail.overview?.representativeImageUrl || "",
    )?.[1];
    const timer = setTimeout(() => {
      track("archive_gallery_item_viewed", {
        completed_work_id: cwId ? Number(cwId) : null,
        project_id: projectId,
        view_duration_sec: 2,
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [detail, projectId]);

  // [트래킹] 완성작에 연결된 가이드 상세(GuideModal) 진입 후 2초 이상 머물면
  //   completed_work_guide_viewed 1회 전송.
  useEffect(() => {
    if (!activeGuide) return undefined;
    const timer = setTimeout(() => {
      track("completed_work_guide_viewed", {
        guide_id: activeGuide._gid,
        completed_work_id: /\/images\/(\d+)/.exec(
          detail?.overview?.representativeImageUrl || "",
        )?.[1],
        project_id: projectId,
        view_duration_sec: 2,
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [activeGuide, detail, projectId]);

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

  // 타임라인 마일스톤 클릭 → 해당 가이드 상세. guide 이벤트는 thumbUrl(=업로드 이미지)로 카드 매칭.
  const guideByThumb = useMemo(() => {
    const m = {};
    for (const g of guides) if (g.uploadUrl) m[g.uploadUrl] = g;
    return m;
  }, [guides]);

  // 반복 문제 TOP 순위별 횟수(정본: 순위 + 횟수) — 가이드 primaryFocus 빈도로 집계.
  const recurringCount = useMemo(() => {
    const m = {};
    for (const g of guides) {
      const pf = g.guide?.primary_focus;
      if (pf) m[pf] = (m[pf] || 0) + 1;
    }
    return m;
  }, [guides]);

  const saveName = async () => {
    const next = name.trim();
    setEditingTitle(false);
    if (!next || next === detail?.overview?.projectName) return;
    setSavingName(true);
    try {
      await updateProject(projectId, { name: next });
    } catch {
      setName(detail?.overview?.projectName || ""); // 실패 시 원복
    } finally {
      setSavingName(false);
    }
  };

  // 정본 [동작] 내보내기 — 대표 이미지 다운로드(인증 fetch→blob→저장, 새 창·라우팅 없음).
  const handleExport = () => {
    setMenuOpen(false);
    const url = detail?.overview?.representativeImageUrl;
    const id = /\/images\/(\d+)/.exec(url || "")?.[1];
    downloadImage(id ? Number(id) : null, url);
  };

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
  // [트래킹] completed_work_id 소스 — 대표 이미지 /images/{id}.
  const completedWorkId =
    Number(/\/images\/(\d+)/.exec(ov.representativeImageUrl || "")?.[1]) || null;
  const timeline = detail.timeline || [];
  // 정본: 8개 초과 시 6번째 이후 생략, 마지막 단계만 표시(가운데 …). '전체 보기'로 전 단계 펼침.
  const timelineCollapsed = !timelineOpen && timeline.length > TIMELINE_HEAD;
  const headNodes = timelineCollapsed ? timeline.slice(0, 6) : timeline;
  const tailNode = timelineCollapsed ? timeline[timeline.length - 1] : null;
  const trend = toTrend(trendByGroup[tab]);
  // 모아보기 필터(정본 탭: 전체/형태/구조/표현/연출) — 가이드 track group 으로 필터, 최대 6 카드.
  const filteredGuides = guides
    .filter(
      (g) =>
        guideTab === "전체" || g.guide?.next_steps?.track?.group === guideTab,
    )
    .slice(0, 6);

  // 타임라인 노드 렌더러(head·tail 공용). guide 이벤트 중 카드 매칭 시 클릭 → 가이드 상세.
  const renderTlNode = (ev, key) => {
    const g = ev.type === "guide" ? guideByThumb[ev.thumbUrl] : null;
    const Node = g ? "button" : "div";
    return (
      <Node
        key={key}
        type={g ? "button" : undefined}
        className={`${styles.tlNode} ${g ? styles.tlNodeClickable : ""}`}
        onClick={g ? () => setActiveGuide(g) : undefined}
        title={g ? "이 시점 가이드 상세 보기" : undefined}
      >
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
      </Node>
    );
  };

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
        {editingTitle ? (
          <input
            className={styles.titleInput}
            value={name}
            autoFocus
            disabled={savingName}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") {
                setName(ov.projectName || "");
                setEditingTitle(false);
              }
            }}
            aria-label="작품 제목 수정"
          />
        ) : (
          <>
            <h1 className={styles.pageTitle}>{name || "완성작"}</h1>
            <button
              type="button"
              className={styles.editTitle}
              onClick={() => setEditingTitle(true)}
              aria-label="제목 수정"
              title="제목 수정"
            >
              ✎
            </button>
          </>
        )}
        <div className={styles.menuWrap}>
          <button
            type="button"
            className={styles.menuBtn}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="더보기"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div
                className={styles.menuBackdrop}
                onClick={() => setMenuOpen(false)}
                aria-hidden
              />
              <div className={styles.menu} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    setEditingTitle(true);
                  }}
                >
                  작품 정보 수정
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleExport}
                >
                  내보내기
                </button>
              </div>
            </>
          )}
        </div>
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
              <span className={styles.statLabel}>
                <IconFolder />총 작업일
              </span>
              <span className={styles.statValue}>{ov.workDays ?? 0}일</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>
                <IconDoc />
                가이드 요청
              </span>
              <span className={styles.statValue}>{ov.guideCount ?? 0}회</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>
                <IconArchive />
                저장한 레퍼런스
              </span>
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
                {(detail.recurringTop || [])
                  .slice(0, chipOpen ? undefined : 3)
                  .map((ax, i) => (
                    <li key={ax + i} className={styles.rankItem}>
                      <span className={styles.rankNum}>{i + 1}</span>
                      <span className={styles.rankLabel}>{axisLabel(ax)}</span>
                      {recurringCount[ax] > 0 && (
                        <span className={styles.rankCount}>
                          {recurringCount[ax]}회
                        </span>
                      )}
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
                {(detail.improvedItems || [])
                  .slice(0, chipOpen ? undefined : 3)
                  .map((ax, i) => (
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
          {/* 정본: '더 많은 항목 보기 >' — 반복·개선 중 하나라도 3개 초과 시 노출. */}
          {((detail.recurringTop || []).length > 3 ||
            (detail.improvedItems || []).length > 3) && (
            <button
              type="button"
              className={styles.chipMore}
              onClick={() => setChipOpen((v) => !v)}
            >
              {chipOpen ? "접기" : "더 많은 항목 보기 ›"}
            </button>
          )}
        </section>
      </div>

      {/* 성장 타임라인 */}
      {timeline.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>성장 타임라인</h2>
              <p className={styles.sectionSub}>
                처음 가이드를 요청한 시점부터 얼마나 성장했는지 한눈에 확인할 수
                있어요.
              </p>
            </div>
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
            {headNodes.map((ev, i) => renderTlNode(ev, i))}
            {timelineCollapsed && (
              <span className={styles.tlEllipsis} aria-hidden>
                ⋯
              </span>
            )}
            {tailNode && renderTlNode(tailNode, "tail")}
          </div>
        </section>
      )}

      {/* 드로잉 과정 갤러리 */}
      {(detail.processGallery || []).length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>드로잉 과정 갤러리</h2>
          <p className={styles.sectionSub}>
            그림 완성 과정을 모아볼 수 있어요.
          </p>
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
              onClick={() => {
                track("completed_work_guide_opened", {
                  completed_work_id: completedWorkId,
                  project_id: projectId,
                  guide_count: guides.length,
                });
                setCollectionOpen(true);
              }}
            >
              전체보기 ›
            </button>
          </div>
          <div className={styles.tabs} role="tablist">
            {GROUP_TABS.map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={guideTab === g}
                className={`${styles.tab} ${guideTab === g ? styles.tabActive : ""}`}
                onClick={() => setGuideTab(g)}
              >
                {g}
              </button>
            ))}
          </div>
          <div className={styles.guideGrid}>
            {filteredGuides.length === 0 && (
              <p className={styles.rankEmpty}>이 항목의 가이드가 없어요.</p>
            )}
            {filteredGuides.map((g, i) => {
              const grp = g.guide?.next_steps?.track?.group;
              const axes = (g.guide?.blocks || [])
                .map((b) => b.sub_problem)
                .filter(Boolean)
                .slice(0, 2);
              return (
                <button
                  key={g._gid ?? i}
                  type="button"
                  className={styles.guideRow}
                  onClick={() => {
                    track("completed_work_guide_clicked", {
                      guide_id: g._gid,
                      completed_work_id: completedWorkId,
                      project_id: projectId,
                      guide_category: g.guide?.primary_focus ?? grp ?? null,
                      days_since_guide_created: g.createdAt
                        ? Math.max(
                            0,
                            Math.floor(
                              (Date.now() - Date.parse(g.createdAt)) / 86400000,
                            ),
                          )
                        : null,
                      guide_position: i,
                    });
                    setActiveGuide(g); // 정본: 항목 클릭 → 가이드 상세
                  }}
                >
                  <span className={styles.guideRowMain}>
                    <span className={styles.guideRowTitle}>
                      {g.guideTitle ||
                        axisLabel(g.guide?.primary_focus) ||
                        "한 끗"}
                    </span>
                    {g.guide?.one_thing && (
                      <span className={styles.guideRowSummary}>
                        {g.guide.one_thing}
                      </span>
                    )}
                    <span className={styles.guideRowTags}>
                      {grp && (
                        <span className={styles.guideRowGroup}>{grp}</span>
                      )}
                      {axes.map((ax, j) => (
                        <span key={j} className={styles.guideRowTag}>
                          {axisLabel(ax)}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className={styles.guideRowDate}>
                    {fmtMonthDay(g.createdAt)}
                  </span>
                  <span className={styles.guideRowChevron} aria-hidden>
                    ›
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 가장 많이 참고한 레퍼런스 + 질문 성장 과정 (정본: 2단 배치) */}
      <div className={styles.twoCol}>
        {(detail.topReferences || []).length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>
                  가장 많이 참고한 레퍼런스
                </h2>
                <p className={styles.sectionSub}>
                  다음의 레퍼런스를 가장 많이 참고했어요.
                </p>
              </div>
              <button
                type="button"
                className={styles.moreLink}
                onClick={() => navigate("/archive/references")}
              >
                모든 레퍼런스 보기 ›
              </button>
            </div>
            <div className={styles.refList}>
              {detail.topReferences.map((r, i) => (
                <button
                  key={r.refId ?? i}
                  type="button"
                  className={styles.refItem}
                  onClick={() =>
                    setLightboxRef({
                      url: refUrlById[r.refId] || r.url,
                      count: r.count,
                    })
                  }
                >
                  <span className={styles.refRank}>{i + 1}</span>
                  <span className={styles.refThumb}>
                    <AuthedImage
                      className={styles.refThumbImg}
                      src={refUrlById[r.refId] || r.url}
                      alt=""
                    />
                  </span>
                  <span className={styles.refMeta}>
                    <span className={styles.refName}>
                      {r.name || "참고 레퍼런스"}
                    </span>
                    <span className={styles.refCount}>참고 {r.count}회</span>
                    {(r.tags || []).length > 0 && (
                      <span className={styles.refTags}>
                        {r.tags.map((t, j) => (
                          <span key={j} className={styles.refTag}>
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className={styles.refChevron} aria-hidden>
                    ›
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 질문 성장 과정 — 전체 대화 보기 → 채팅 이동 */}
        {(detail.questionGrowth || []).length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>질문 성장 과정</h2>
                <p className={styles.sectionSub}>
                  질문이 깊어질수록 더 멀리 성장할 수 있어요.
                </p>
              </div>
              <button
                type="button"
                className={styles.moreLink}
                onClick={() => navigate(`/projects/${projectId}/chat`)}
              >
                전체 대화 보기 ›
              </button>
            </div>
            <div className={styles.qGrowth}>
              {detail.questionGrowth.map((q, i) => (
                <div key={i} className={styles.qRow}>
                  <span className={styles.qPhase}>
                    <span className={styles.qDate}>{fmtMonthDay(q.date)}</span>
                    <span className={styles.qPhaseName}>{q.phase}</span>
                  </span>
                  <span className={styles.qDot} aria-hidden />
                  <span className={styles.qBubble}>{q.text}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 모아보기 오버레이 — absolute 패널이 온전한 크기로 뜨도록 fixed 호스트 제공(버그2 포지셔닝). */}
      {collectionOpen && (
        <div
          className={styles.panelHost}
          onClick={() => setCollectionOpen(false)}
        >
          <div
            className={styles.panelFrame}
            onClick={(e) => e.stopPropagation()}
          >
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

      {/* TOP 레퍼런스 원본 크게 보기(라이트박스). */}
      {lightboxRef && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-label="레퍼런스 원본"
          onClick={() => setLightboxRef(null)}
        >
          <button
            type="button"
            className={styles.lightboxClose}
            onClick={() => setLightboxRef(null)}
            aria-label="닫기"
          >
            ✕
          </button>
          <div
            className={styles.lightboxInner}
            onClick={(e) => e.stopPropagation()}
          >
            <AuthedImage
              className={styles.lightboxImg}
              src={lightboxRef.url}
              alt="레퍼런스"
            />
            <p className={styles.lightboxCaption}>참고 {lightboxRef.count}회</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompletedDetailPage;
