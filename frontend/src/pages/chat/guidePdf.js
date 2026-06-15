// guidePdf.js — 한 끗 가이드 → PDF (클라이언트). 디자인 메모: "가이드는 복사 대신 PDF 다운로드 버튼".
//
// 무거운 의존성(jspdf/html2canvas) 없이, 브라우저의 인쇄 파이프라인("PDF로 저장")을 쓴다.
//  - 한글/이모지/SVG 차트가 그대로 렌더(브라우저 폰트) → 별도 폰트 베이크 불필요.
//  - 클릭(사용자 제스처)에서 새 창을 열고 인쇄를 트리거하므로 팝업 차단에 안 걸린다.
// GuideModal 의 섹션 구조(분석/읽히는 느낌/한 끗 포인트/추천 레퍼런스/다음 목표/성장 흐름)를 그대로 옮긴다.

const AXIS_LABELS = {
  weight_balance: "무게중심", foreshortening: "단축", proportion: "비율",
  action_line: "동세선", joint_articulation: "관절", hand_structure: "손 구조",
  value_structure: "명암 대비", composition_balance: "구도·균형", color_harmony: "색 조화",
  light_direction: "광원 방향", linear_perspective: "선원근", atmospheric_perspective: "대기원근",
  depth_layering: "깊이층", horizon_placement: "지평선",
};
const axisLabel = (id) => AXIS_LABELS[id] || (id ? id.replace(/_/g, " ") : "");

// 텍스트 → HTML 안전 이스케이프(가이드 본문은 신뢰되지만 방어적으로).
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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

// 성장 면적 차트 SVG(모달의 GrowthChart 와 동일한 형태) → 인쇄용 정적 마크업.
function growthChartSvg(trend) {
  if (!trend || trend.length < 2) return "";
  const W = 520, H = 150, PAD = 8;
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
  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:150px">
      <defs>
        <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f2853f" stop-opacity="0.34"/>
          <stop offset="100%" stop-color="#f2853f" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#gf)"/>
      <path d="${line}" fill="none" stroke="#ee6f2d" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
}

function chip(label) {
  return `<span class="chip">${esc(label)}</span>`;
}

// guide(JSON) → 인쇄용 본문 HTML. GuideModal 의 섹션 순서를 그대로 따른다.
function bodyHtml(guide, references, drawingPreviewUrl) {
  const blocks = guide.blocks || [];
  const primary = blocks[0];
  const extra = blocks.slice(1);
  const next = guide.next_steps;
  const hasPractice = !!next?.focus_practice; // 있으면 반복(추천 연습) 레이아웃, 없으면 최초(분석/읽히는 느낌)
  const primaryRefs = primary
    ? (references || []).filter((r) => (primary.reference_ids || []).includes(r.refId))
    : [];
  let num = 0;
  const out = [];

  const section = (title, inner, accent = false) =>
    `<section class="sec">
       <h3 class="secTitle${accent ? " accent" : ""}"><span class="num">${num}.</span>${esc(title)}</h3>
       ${inner}
     </section>`;

  if (hasPractice) {
    const intro = next?.note || guide.synthesis || "";
    if (intro) out.push(`<p class="intro">${esc(intro)}</p>`);
    if (primary?.observation)
      out.push(`<p class="lead">${esc(primary.observation)}${primary.effect ? " " + esc(primary.effect) : ""}</p>`);
    num++; out.push(section("추천 연습", `<div class="box"><p>${esc(next.focus_practice)}</p></div>`));
  } else {
    // 최초 가이드 레이아웃: 1.분석 / 2.읽히는 느낌
    if (primary?.observation) {
      num++;
      const img = drawingPreviewUrl
        ? `<img class="userImg" src="${esc(drawingPreviewUrl)}" alt="첨부한 그림"/>`
        : "";
      out.push(section("분석", `${img}<p class="body">${esc(primary.observation)}</p>`));
    }
    if (primary?.effect) {
      num++; out.push(section("읽히는 느낌", `<p class="body">${esc(primary.effect)}</p>`));
    }
  }

  // 한 끗 포인트
  if (primary && primary.direction) {
    num++; out.push(section("한 끗 포인트", `<div class="tip"><p>${esc(primary.direction)}</p></div>`, true));
  }

  // 추천 레퍼런스
  if (primaryRefs.length > 0) {
    const cards = primaryRefs
      .map(
        (r) => `<figure class="ref">
          <div class="refThumb">${
            r.url ? `<img src="${esc(r.url)}" alt="참고 ${r.ordinal}"/>` : ""
          }<span class="refNum">${esc(r.ordinal)}</span></div>
          <figcaption>참고 ${esc(r.ordinal)}</figcaption>
        </figure>`,
      )
      .join("");
    num++; out.push(section("추천 레퍼런스", `<div class="refGrid">${cards}</div>`));
  }

  // 함께 보면 좋은 것(보조 블록)
  if (extra.length > 0) {
    const lines = extra
      .map((b) => `<p class="extra"><strong>${esc(axisLabel(b.sub_problem))}</strong> ${esc(b.direction || b.observation)}</p>`)
      .join("");
    out.push(`<section class="sec"><h3 class="secTitle">함께 보면 좋은 것</h3>${lines}</section>`);
  }

  // 앞으로 해야 할 것
  if (next && (next.next_goal_practice || next.next_goal)) {
    num++;
    const goal = `<div class="goal">
        <span class="badge">다음 목표</span>
        ${next.next_goal ? `<span class="goalAxis">${esc(axisLabel(next.next_goal))}</span>` : ""}
        ${next.next_goal_practice ? `<p>${esc(next.next_goal_practice)}</p>` : ""}
      </div>`;
    out.push(section("앞으로 해야 할 것", goal));
  }

  // 성장 흐름
  const growth = guide.growth;
  if (growth) {
    const trend = growth.trend || [];
    const hasChart = trend.length >= 2;
    const delta = hasChart ? growthDelta(trend) : null;
    const msg = hasChart
      ? deltaMessage(delta)
      : growth.narration || "처음으로 한 끗 가이드를 사용하셨어요! 가이드를 더 받을수록 어떤 어려움을 자주 겪는지 흐름으로 보여드려요.";
    const current = growth.chips?.current_stage_axes || [];
    const improving = growth.chips?.improving_axes || [];
    out.push(`
      <section class="sec">
        <h3 class="secTitle accent">성장 흐름</h3>
        <div class="growthBox">
          ${hasChart ? `<p class="chartTitle">그림 한 장당 어려움을 느낀 횟수</p>${growthChartSvg(trend)}` : ""}
          ${delta && delta.pct != null && delta.dir !== "flat"
            ? `<p class="deltaTag">${delta.pct}% ${delta.dir === "down" ? "감소" : "증가"}</p>` : ""}
          <p class="growthMsg">${esc(msg)}</p>
        </div>
        ${current.length ? `<p class="chipRow"><span class="chipLabel">현재 그림 단계</span>${current.map((a) => chip(axisLabel(a))).join("")}</p>` : ""}
        ${improving.length ? `<p class="chipRow"><span class="chipLabel">최근에 덜 보이는 어려움</span>${improving.map((a) => chip(axisLabel(a))).join("")}</p>` : ""}
      </section>`);
  }

  return out.join("\n");
}

function deltaMessage(d) {
  if (!d) return "";
  if (d.dir === "down")
    return d.pct != null
      ? `처음 가이드를 받았을 때보다 어려움을 느낀 부분이 ${d.pct}% 줄었어요. 연습한 흐름이 그래프에 보여요.`
      : "처음보다 어려움을 느낀 부분이 줄었어요.";
  if (d.dir === "up")
    return d.pct != null
      ? `최근에 어려움을 느낀 부분이 ${d.pct}% 늘었어요. 지금 구간을 조금 더 챙겨보면 좋아요.`
      : "최근에 어려움을 느낀 부분이 늘었어요.";
  return "최근 어려움을 느낀 정도가 비슷하게 유지되고 있어요.";
}

const PRINT_CSS = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; padding: 32px 36px; color: #2d2a26;
         font-family: "Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #9a9186; font-size: 12px; margin: 0 0 20px; }
  .sec { margin: 0 0 18px; page-break-inside: avoid; }
  .secTitle { font-size: 15px; font-weight: 700; margin: 0 0 8px; }
  .secTitle .num { color: #ee6f2d; margin-right: 6px; }
  .secTitle.accent { color: #ee6f2d; }
  .intro, .lead { margin: 0 0 12px; }
  .body, .box p, .tip p, .goal p { margin: 0; font-size: 14px; }
  .box, .tip, .goal, .growthBox { border: 1px solid #f0ece6; border-radius: 12px; padding: 14px 16px; }
  .tip, .growthBox { background: #fff8ef; border-color: #f4e2c6; }
  .userImg { max-width: 220px; max-height: 220px; border-radius: 10px; display: block; margin: 0 0 10px; }
  .refGrid { display: flex; gap: 12px; }
  .ref { margin: 0; flex: 1; }
  .refThumb { position: relative; aspect-ratio: 1; border: 1px solid #eee; border-radius: 10px; overflow: hidden; background: #f4f1ec; }
  .refThumb img { width: 100%; height: 100%; object-fit: cover; }
  .refNum { position: absolute; top: 6px; left: 6px; background: rgba(0,0,0,.6); color: #fff;
            font-size: 11px; width: 18px; height: 18px; border-radius: 50%; display:flex; align-items:center; justify-content:center; }
  .ref figcaption { font-size: 12px; color: #6b655d; margin-top: 6px; text-align: center; }
  .extra { font-size: 14px; margin: 6px 0; }
  .badge { background: #fdf1df; color: #9a7b4a; border: 1px solid #f4e2c6; border-radius: 999px; padding: 2px 8px; font-size: 11px; margin-right: 8px; }
  .goalAxis { font-weight: 700; }
  .chartTitle { font-size: 12px; color: #6b655d; margin: 0 0 6px; }
  .deltaTag { color: #ee6f2d; font-weight: 700; font-size: 13px; margin: 6px 0 0; }
  .growthMsg { font-size: 13px; margin: 8px 0 0; }
  .chipRow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0 0; }
  .chipLabel { font-size: 12px; color: #6b655d; margin-right: 4px; }
  .chip { background: #f4f1ec; border-radius: 999px; padding: 3px 10px; font-size: 12px; }
  @page { margin: 14mm; }
`;

/**
 * 한 끗 가이드를 PDF(브라우저 인쇄 → PDF로 저장)로 내보낸다.
 * @param {{guide:object, references:Array}} result  requestGuide 응답
 * @param {string} [drawingPreviewUrl]  사용자가 첨부한 그림 미리보기(분석 섹션)
 */
export function downloadGuidePdf(result, drawingPreviewUrl) {
  const guide = result?.guide;
  if (!guide) return;
  const references = result?.references || [];
  const title = guide.primary_focus
    ? `${axisLabel(guide.primary_focus)} 한 끗 가이드`
    : "한 끗 가이드";
  const dateStr = new Date().toLocaleDateString("ko-KR");

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>${PRINT_CSS}</style></head>
<body>
  <h1>${esc(title)}</h1>
  <p class="meta">DraWe · ${esc(dateStr)}</p>
  ${bodyHtml(guide, references, drawingPreviewUrl)}
</body></html>`;

  // noopener/noreferrer 를 features 에 넣으면 window.open 이 null 을 반환해(스펙) win.print() 가
  // 절대 실행되지 않고 폴백(Blob 새 탭)만 떴다. 우리가 만든 인쇄 문서라 opener 차단 불필요 → 제거.
  const win = window.open("", "_blank", "width=820,height=1000");
  if (!win) {
    // 팝업 차단 폴백: 동일 문서를 Blob URL 로 새 탭 열기(사용자가 직접 인쇄).
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // 이미지(레퍼런스/첨부)가 로드된 뒤 인쇄해야 PDF 에 그림이 빠지지 않는다.
  const fire = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === "complete") setTimeout(fire, 250);
  else win.onload = () => setTimeout(fire, 250);
}
