#!/usr/bin/env python3
"""routing_kpi.py — 라우팅/캐시 KPI 스냅샷(읽기 전용).

목적은 'grep 자동화'가 아니라 **PR마다 같은 기준으로 비교하는 의사결정 KPI**다. trace 로그를 모아
다음 두 결정 지표를 낸다: (1) Cache miss 비율 = miss/(l1+l2+miss) → 조건부 VLM 투자 가치, (2)
Ambiguous 비율 = ambiguous/전체 → OpenCLIP 라벨 튜닝 필요성. 스냅샷을 저장하면 직전 대비 ±를 보여
"이번 변경이 효과 있었나"를 숫자로 답하게 한다. 코드/서비스는 건드리지 않는다(로그만 읽음).

입력(둘 중 하나):
  docker logs drawe-guide 2>&1 | python routing_kpi.py
  python routing_kpi.py app.log

옵션:
  --save NAME    이번 집계를 스냅샷으로 저장(라벨 NAME, 예: PR번호/날짜)
  --compare      직전 스냅샷과 비교(±). --save 와 함께 쓰면 저장 후 직전과 비교.
  --state PATH   스냅샷 저장 파일(기본 ./.drawe_kpi_snapshots.json)

전제: TRACE_CTX=1 로 [trace:subject]·[trace:vlm.cache] 가 로그에 남아 있어야 한다.
주의: Subject 분포는 VLM 분류분(ambiguous/confident_sketch)만 의미 있다 — CLIP 확신(confident)
요청은 subj 가 None 이라 'unknown(clip-confident)' 로 집계된다(현재 trace 한계, 출력에 표시).
"""

import sys
import re
import json
import argparse
from datetime import datetime, timezone
from collections import Counter

_SUBJECT = re.compile(r"\[trace:subject\][^\n]*\bband=(\w+)[^\n]*\bsubj=(\w+|None)")
_CACHE = re.compile(r"\[trace:vlm\.cache\][^\n]*\bfn=(\w+)[^\n]*\btier=(\w+)")


def parse(lines):
    bands, subjects, tiers = Counter(), Counter(), Counter()
    for ln in lines:
        m = _SUBJECT.search(ln)
        if m:
            bands[m.group(1)] += 1
            subjects[m.group(2)] += 1
            continue
        m = _CACHE.search(ln)
        if m:
            tiers[m.group(2)] += 1
    return bands, subjects, tiers


def compute(bands, subjects, tiers):
    total = sum(bands.values())  # [trace:subject] 1줄/요청 ≈ Total Requests
    events = sum(tiers.values())  # vlm.cache 1줄/VLM호출 = 캐시 이벤트
    l1, l2, miss = tiers.get("l1", 0), tiers.get("l2", 0), tiers.get("miss", 0)
    hits = l1 + l2
    return {
        "total_requests": total,
        "cache_events": events,
        "l1": l1,
        "l2": l2,
        "miss": miss,
        "cache_hit_rate": (hits / events) if events else 0.0,
        "miss_rate": (miss / events) if events else 0.0,  # ← 결정지표 1
        "band": dict(bands),
        "ambiguous_rate": (bands.get("ambiguous", 0) / total)
        if total
        else 0.0,  # ← 결정지표 2
        "subject": dict(subjects),
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }


def _pct(x):
    return f"{x * 100:.1f}%"


def _line(label, value, total=None, width=22):
    s = f"{label:<{width}}: {value:>6,}"
    if total:
        s += f" ({_pct(value / total)})" if total else ""
    return s


def render(k, prev=None):
    out = []
    A = out.append

    def delta(key, lower_better=True):
        if not prev or key not in prev:
            return ""
        d = k[key] - prev[key]
        if abs(d) < 1e-9:
            return "  (=)"
        arrow = "↑" if d > 0 else "↓"  # 변화 방향
        good = (d < 0) if lower_better else (d > 0)  # 지표별 '좋은 방향'
        mark = "✓" if good else "▲"
        sign = "+" if d > 0 else "−"
        return f"  ({sign}{_pct(abs(d))} {arrow}{mark})"

    A("===== Routing / Cache KPI =====")
    A(f"As of                 : {k['ts']}")
    if prev:
        A(f"vs snapshot           : {prev.get('label', prev.get('ts', '?'))}")
    A(_line("Total Requests", k["total_requests"]))
    A("")
    A("Cache  (분모=VLM 캐시 이벤트)")
    A("-------------------------")
    ev = k["cache_events"] or 1
    A(_line("L1 Hit", k["l1"], ev))
    A(_line("L2 Hit", k["l2"], ev))
    A(_line("Miss (실제 VLM 호출)", k["miss"], ev))
    A(
        f"{'Overall Cache Hit':<22}: {_pct(k['cache_hit_rate'])}"
        + delta("cache_hit_rate", lower_better=False)
    )
    A(
        f"{'Miss Rate ★결정1':<22}: {_pct(k['miss_rate'])}"
        + delta("miss_rate", lower_better=True)
    )
    A("")
    A("Routing  (분모=요청)")
    A("-------------------------")
    tot = k["total_requests"] or 1
    for b in ("confident", "confident_sketch", "ambiguous"):
        A(_line(b, k["band"].get(b, 0), tot))
    A(
        f"{'Ambiguous Rate ★결정2':<22}: {_pct(k['ambiguous_rate'])}"
        + delta("ambiguous_rate", lower_better=True)
    )
    A("")
    A("Subject  (VLM 분류분만; confident=unknown)")
    A("-------------------------")
    sub = k["subject"]
    for name in ("hand", "figure", "landscape", "still_life", "face"):
        if sub.get(name):
            A(_line(name, sub[name]))
    if sub.get("None"):
        A(_line("unknown(clip-confident)", sub["None"]))
    A("")
    A("해석 가이드")
    A("-------------------------")
    A(f"  Miss Rate {_pct(k['miss_rate'])} → 조건부 VLM 최적화로 줄일 수 있는 상한")
    A(
        f"  Ambiguous {_pct(k['ambiguous_rate'])} → 높으면 OpenCLIP 라벨/프롬프트 튜닝 ROI↑"
    )
    return "\n".join(out)


def load_state(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def save_state(path, snaps):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snaps, f, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser(description="라우팅/캐시 KPI 스냅샷(읽기 전용)")
    ap.add_argument("logfile", nargs="?", help="로그 파일(없으면 stdin)")
    ap.add_argument("--save", metavar="NAME", help="스냅샷 저장(라벨)")
    ap.add_argument("--compare", action="store_true", help="직전 스냅샷과 비교")
    ap.add_argument(
        "--state", default=".drawe_kpi_snapshots.json", help="스냅샷 저장 파일"
    )
    args = ap.parse_args()

    src = (
        open(args.logfile, encoding="utf-8", errors="replace")
        if args.logfile
        else sys.stdin
    )
    bands, subjects, tiers = parse(src)
    k = compute(bands, subjects, tiers)

    if k["total_requests"] == 0 and k["cache_events"] == 0:
        print(
            "trace 로그를 못 찾았습니다. TRACE_CTX=1 인지, 로그 범위가 맞는지 확인하세요.",
            file=sys.stderr,
        )
        sys.exit(2)

    snaps = load_state(args.state)
    prev = snaps[-1] if (args.compare and snaps) else None
    print(render(k, prev))

    if args.save:
        rec = dict(k)
        rec["label"] = args.save
        snaps.append(rec)
        save_state(args.state, snaps)
        print(f"\n[saved] '{args.save}' → {args.state} (총 {len(snaps)}개 스냅샷)")


if __name__ == "__main__":
    main()
