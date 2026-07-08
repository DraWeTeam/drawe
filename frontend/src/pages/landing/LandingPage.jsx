import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./LandingPage.module.css";
import primaryLogo from "../../assets/primary_logo.png";
import footerLogo from "../../assets/footer_logo.png";
import heroShot from "../../assets/hero_shot.png";
import featureShot from "../../assets/guide_shot.png";
import featureCardShot from "../../assets/ref_shot.png";
import archiveShot from "../../assets/archive_shot.png";

// 랜딩 페이지 — Figma 스펙 기준(1570px 디자인, 섹션 프레임 radius 64, 40px gap).
// 스크롤 순서: 히어로 → 페인포인트 → 기능 → 아카이브 → 철학/CTA/푸터.
const LandingPage = () => {
  const navigate = useNavigate();
  const goTrial = () => navigate("/login");

  // 스크롤 진입 시 페이드+슬라이드업 (IntersectionObserver)
  const revealRefs = useRef([]);
  const addReveal = (el) => {
    if (el && !revealRefs.current.includes(el)) revealRefs.current.push(el);
  };

  useEffect(() => {
    const els = revealRefs.current;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!("IntersectionObserver" in window) || reduceMotion) {
      els.forEach((el) => el.classList.add(styles.revealVisible));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // 들어오면 재생, 벗어나면 리셋 → 다시 스크롤하면 재생
          entry.target.classList.toggle(
            styles.revealVisible,
            entry.isIntersecting,
          );
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className={styles.page}>
      {/* ===== 상단 네비 ===== */}
      <header className={styles.nav}>
        <span className={styles.brand}>
          <img className={styles.brandLogo} src={primaryLogo} alt="DraWe" />
        </span>
        <button type="button" className={styles.navCta} onClick={goTrial}>
          무료 체험하기
        </button>
      </header>

      <div className={styles.frames}>
        {/* ===== Frame 1. 히어로 ===== */}
        <section ref={addReveal} className={`${styles.hero} ${styles.reveal}`}>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>
              <span>상상을 그림으로,</span>
              <span className={styles.heroTitleSub}>
                그림 과정에 함께하는 AI
              </span>
            </h1>
            <p className={styles.heroDesc}>
              그림에만 집중할 수 있도록. 막힘을 함께 풀어드립니다
            </p>
            <button type="button" className={styles.pillBtn} onClick={goTrial}>
              무료 체험하기
            </button>
          </div>
          <img className={styles.heroShot} src={heroShot} alt="" />
        </section>

        {/* ===== Frame 2. 페인포인트 ===== */}
        <section
          ref={addReveal}
          className={`${styles.painFrame} ${styles.reveal}`}
        >
          <h2 className={styles.frameTitle}>
            그림을 그리면서 이런 적 있으신가요?
          </h2>
          <div className={styles.painRow}>
            {PAIN_POINTS.map((p) => (
              <div key={p.title} className={styles.painCard}>
                <h3 className={styles.painTitle}>{p.title}</h3>
                <p className={styles.painDesc}>{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== Frame 3. 기능 ===== */}
        <section
          ref={addReveal}
          className={`${styles.featFrame} ${styles.reveal}`}
        >
          <h2 className={styles.frameTitle}>DraWe가 도와드려요.</h2>

          <div className={styles.featCol}>
            {/* 한 끗 가이드 (넓은 카드) */}
            <div className={styles.featRowWide}>
              <div className={styles.featText}>
                <h3 className={styles.featTitle}>한 끗 가이드</h3>
                <p className={styles.featDesc}>
                  AI가 그림을 분석해 수정해야할 부분,
                  <br />
                  이론적인 조언 등을 담은 가이드를 제공해요.
                </p>
              </div>
              <div className={styles.featWideShot}>
                <img src={featureShot} alt="" />
              </div>
            </div>

            {/* 맞춤 레퍼런스 추천 / 성장 흐름 추적 */}
            <div className={styles.featRow2}>
              <div className={styles.featCardRef}>
                <div className={styles.featText}>
                  <h3 className={styles.featTitle}>맞춤 레퍼런스 추천</h3>
                  <p className={styles.featDesc}>
                    원하는 레퍼런스 이미지를 키워드 검색을 통해 탐색해요.
                    <br />
                    그림을 그리면서 볼 수 있도록 분할화면에 최적화했어요.
                  </p>
                </div>
                <img
                  className={styles.featRefShot}
                  src={featureCardShot}
                  alt=""
                />
              </div>

              <div className={styles.featCardGrowth}>
                <div className={styles.featText}>
                  <h3 className={styles.featTitle}>성장 흐름 추적</h3>
                  <p className={styles.featDesc}>
                    성장 과정을 한 눈에 보여줘요.
                    <br />
                    월간 성장 추이는 아카이브에서 확인할 수 있어요.
                  </p>
                </div>
                <GrowthChart />
              </div>
            </div>
          </div>
        </section>

        {/* ===== Frame 4. 아카이브 ===== */}
        <section
          ref={addReveal}
          className={`${styles.archiveFrame} ${styles.reveal}`}
        >
          <div className={styles.archiveHead}>
            <h2 className={styles.frameTitle}>
              아카이브에서 나의 그림 성장 과정을 확인해요.
            </h2>
            <p className={styles.archiveSub}>
              한 그림을 완성하기 위한 도구가 아닌, 당신의 그림 실력 성장을 위해
              모든 여정을 함께해요.
            </p>
          </div>
          <div className={styles.archiveShotWrap}>
            <img className={styles.archiveShot} src={archiveShot} alt="" />
            {/* Frame 465 — "준비 중" 반투명 배너 오버레이 */}
            <div className={styles.archivePending}>
              그림 여정을 기록하는 아카이브 기능은 현재 준비 중입니다.
            </div>
          </div>
        </section>

        {/* ===== Frame 5. 철학 ===== */}
        <section
          ref={addReveal}
          className={`${styles.philoFrame} ${styles.reveal}`}
        >
          <div className={styles.philoLeft}>
            <h2 className={styles.philoTitle}>
              죄송하지만 도와<span className={styles.philoAccent}>'만'</span>{" "}
              드릴게요
            </h2>
            <p className={styles.philoDesc}>
              DraWe는 여러분을 대신해서 그림을 그리지 않습니다.
              <br />
              우리는 여러분이 직접 그리고, 직접 성장하는 과정을 돕습니다.
              <br />
              AI는 답을 대신 만들어주는 도구가 아니라 배움을 돕는 조력자라고
              믿습니다.
            </p>
          </div>
          <div className={styles.philoRight}>
            <div className={styles.valueGrid}>
              {VALUES.map((v) => (
                <div key={v.text} className={styles.valueCard}>
                  <span className={styles.valueIcon}>{v.icon}</span>
                  <p className={styles.valueText}>{v.text}</p>
                </div>
              ))}
            </div>
            <p className={styles.valueNote}>
              *DraWe의 이미지 생성 기능은 라이선스가 사전에 확보된 콘텐츠만
              사용합니다.
            </p>
          </div>
        </section>

        {/* ===== Frame 6. CTA ===== */}
        <section
          ref={addReveal}
          className={`${styles.ctaFrame} ${styles.reveal}`}
        >
          <p className={styles.ctaText}>
            오늘은 DraWe와 함께 끝까지 그림 완성해보기, 어떠신가요?
          </p>
          <button type="button" className={styles.ctaBtn} onClick={goTrial}>
            무료 체험하기
          </button>
        </section>
      </div>

      {/* ===== 푸터 ===== */}
      <footer className={styles.footer}>
        <span className={styles.footerBrand}>
          <img className={styles.footerLogo} src={footerLogo} alt="DraWe" />
        </span>
        <div className={styles.footerInfo}>
          <p className={styles.footerLinks}>DraWe 서비스 링크</p>
          <p className={styles.footerContact}>이메일: drawe3648@gmail.com</p>
        </div>
      </footer>
    </div>
  );
};

const PAIN_POINTS = [
  {
    title: "인체·포즈가 안 잡혀서 한참 헤맸어요.",
    desc: "원하는 자세는 머릿속에 있는데\n어디를 참고해서 어떻게 그려야 할지 모르겠어요.",
  },
  {
    title: "원하는 분위기의 레퍼런스를 찾기 어려웠어요.",
    desc: "수십 장을 검색해도\n내가 그리고 싶은 느낌은 찾기 힘들어요.",
  },
  {
    title: "막혔을 때 누구에게 물어볼지 모르겠어요",
    desc: "혼자 그리다 보면\n어디가 문제인지조차 알기 어려워요.",
  },
];

const VALUES = [
  { icon: <PencilIcon />, text: "직접 그리는 경험을\n존중합니다." },
  { icon: <UserIcon />, text: "창작의 주인은\n언제나 사용자입니다." },
  { icon: <ThumbIcon />, text: "그림 실력 향상에\n집중합니다." },
];

const X_LABELS = [
  "03.27",
  "04.01",
  "04.03",
  "04.05",
  "04.17",
  "04.29",
  "05.12",
];

// 성장 흐름(감소 추세) 차트 — Frame 412 스펙 재현.
const GrowthChart = () => (
  <div className={styles.chartCard}>
    <div className={styles.chartHead}>
      <p className={styles.chartTitle}>최근 30일 통계</p>
      <p className={styles.chartAxis}>
        X: 최근 30일 &nbsp; Y: 주별 가이드 요청 횟수
      </p>
    </div>
    <div className={styles.chartBody}>
      <div className={styles.chartY}>
        <span>6</span>
        <span>3</span>
        <span>0</span>
      </div>
      <div className={styles.chartPlot}>
        <svg
          className={styles.chartSvg}
          viewBox="0 0 533 120"
          preserveAspectRatio="none"
          fill="none"
        >
          <defs>
            <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff8534" stopOpacity="1" />
              <stop offset="100%" stopColor="#ff8534" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 20 L75 16 L150 24 L225 58 L300 66 L375 82 L455 94 L533 100 L533 120 L0 120 Z"
            fill="url(#growthFill)"
          />
        </svg>
      </div>
    </div>
    <div className={styles.chartX}>
      {X_LABELS.map((x) => (
        <span key={x}>{x}</span>
      ))}
    </div>
  </div>
);

/* ===== 아이콘 ===== */
function PencilIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5ZM20.7 6.3a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0L16 5l3.5 3.5 1.2-1.2Z"
        fill="currentColor"
      />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5Z"
        fill="currentColor"
      />
    </svg>
  );
}
function ThumbIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M2 10h4v11H2V10Zm6 0 4.5-7c.9.1 1.5.9 1.4 1.8L13 9h6.5c1 0 1.8.9 1.6 1.9l-1.6 8c-.2.9-1 1.6-2 1.6H8V10Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default LandingPage;
