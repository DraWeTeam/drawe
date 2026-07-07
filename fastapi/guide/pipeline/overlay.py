"""overlay.py — 사용자 그림 위 지시사항(SVG 오버레이). 배치 위치: fastapi/guide/pipeline/overlay.py

핵심: pose 신뢰도 tier 가 '입도(granularity)'를 정한다.
  OK   → 관절/지점 정밀 표기(점 + 화살표 + 라벨)
  LOW  → 형체 영역 코스 하이라이트 하나로 묶고 "대략 이 부근"(관절 화살표 없음)
  FAIL → 형체 표기 없음 — 이미지 축(지평선·전역)만

불변식(절대 위반 금지):
  • measured=False 인 축은 그림 위에 절대 표기하지 않는다(못 잰 걸 가리키지 않음).
  • tier 가 OK 가 아니면 관절 단위 정밀 앵커를 쓰지 않는다(자신 있게 틀린 위치 방지).

순수 모듈: numpy/torch 등 무거운 의존성 없음(문자열로 SVG 생성) → 단독 단위테스트 용이.
좌표는 정규화(0..1) 입력을 받아 width/height 로 환산한다.
"""

from __future__ import annotations
from html import escape

VIS_KP = 0.3  # 키포인트 가시도 하한(diagnose._figure_bbox 와 동일 기준)

# diagnose.REGION_KP 와 동일(의존성 분리를 위해 최소 복제 — 바뀌면 양쪽 같이).
REGION_KP = {
    "weight_balance": ["left_hip", "right_hip", "left_ankle", "right_ankle"],
    "foreshortening": ["left_wrist", "right_wrist", "left_elbow", "right_elbow"],
    "proportion": ["nose", "left_ankle", "right_ankle"],
    "action_line": ["nose", "left_hip", "right_hip"],
    "joint_articulation": ["left_elbow", "right_elbow", "left_knee", "right_knee"],
}
NAME2IDX = {
    "nose": 0,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_elbow": 13,
    "right_elbow": 14,
    "left_wrist": 15,
    "right_wrist": 16,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
}
HORIZON_AXES = {"atmospheric_perspective"}  # 지평선 hline 으로 앵커(튜닝 대상)

# 사용자에게 보이는 짧은 라벨(내부 신호 문구가 새지 않게 큐레이션). 미정의 축은 id 폴백.
_LABEL = {
    "weight_balance": "무게중심",
    "foreshortening": "단축",
    "proportion": "비율",
    "action_line": "동세",
    "joint_articulation": "관절",
    "composition_balance": "구도",
    "value_structure": "명암 대비",
    "value_compression": "원경 명암",
    "atmospheric_perspective": "대기원근",
    "light_direction": "광원 방향",
    "figure_bg_contrast": "실루엣 대비",
}
_FIGURE_KINDS = {"point", "region"}  # 형체에 묶인 앵커(tier 로 입도 강등 대상)


# ── 앵커 결정 ────────────────────────────────────────────────────────────────────────────────
def resolve_anchors(observations, spatial, tier):
    """관측치 → 표기할 주석 목록. spatial = {keypoints, bbox, centroid, horizon_y}(정규화).
    keypoints/bbox/centroid/horizon_y 는 diagnose 가 이미 계산하는 값(노출만 하면 됨)."""
    kps = spatial.get("keypoints")
    bbox = spatial.get("bbox")  # (x0,y0,x1,y1)
    centroid = spatial.get("centroid")  # (cx,cy)
    horizon = spatial.get("horizon_y")
    out = []
    for o in observations:
        if not o.get("measured"):  # 불변식: 못 잰 축은 표기 안 함
            continue
        sp = o.get("sub_problem")
        anchor = None
        # 1) 포즈 축 → 관절 무게중심(점). tier!=OK 면 애초에 measured=False 라 여기 안 옴.
        if sp in REGION_KP and kps:
            pts = [
                (kps[NAME2IDX[n]][0], kps[NAME2IDX[n]][1])
                for n in REGION_KP[sp]
                if NAME2IDX.get(n, 99) < len(kps) and kps[NAME2IDX[n]][2] >= VIS_KP
            ]
            if pts:
                anchor = {
                    "kind": "point",
                    "x": sum(p[0] for p in pts) / len(pts),
                    "y": sum(p[1] for p in pts) / len(pts),
                }
        # 2) 구도 → 피사체 무게중심(점)
        elif sp == "composition_balance" and centroid:
            anchor = {"kind": "point", "x": centroid[0], "y": centroid[1]}
        # 3) 지평선/대기원근 → 수평선
        elif sp in HORIZON_AXES and horizon is not None:
            anchor = {"kind": "hline", "y": float(horizon)}
        # 4) 그 외(명도·빛·실루엣) → 형체 영역(있으면) 아니면 전역
        if anchor is None:
            if bbox:
                anchor = {
                    "kind": "region",
                    "x0": bbox[0],
                    "y0": bbox[1],
                    "x1": bbox[2],
                    "y1": bbox[3],
                }
            else:
                anchor = {"kind": "image"}
        out.append(
            {
                "axis": sp,
                "label": _LABEL.get(sp, sp),
                "measured": True,
                "anchor": anchor,
            }
        )
    return out


# ── 렌더 ────────────────────────────────────────────────────────────────────────────────────
def build_overlay(width, height, annotations, tier, accent="#E8743B"):
    """tier 입도에 따라 주석을 그린 SVG 문자열. 배경 투명(사용자 그림 위 합성용)."""
    # measured=True 만. FAIL 은 kind 로 차단하지 않는다 — 포즈 의존 표기는 어차피 measured=False/
    # keypoints=None 으로 빠지고, 이미지·잉크 기반 앵커(구도 무게중심·지평선·전역)는 남겨야 한다
    # (인물 없는 풍경화 등에서 특히 유용). FAIL 은 정밀 화살표만 끈다(precise=False).
    anns = [a for a in annotations if a.get("measured")]

    # 마커·라벨은 이미지 좌표계(viewBox=원본 WxH)에 그려지므로, 절대 크기(예 r=11)는 큰 원본이
    #   축소 표시될 때 사실상 안 보인다. 원본 크기에 비례한 스케일로 그려 표시 크기를 일정하게 유지
    #   (460px 기준 s=1 — 기존 크기, 그 이상은 확대). 정본(114:15593)의 또렷한 badge 재현.
    s = max(1.0, min(width, height) / 460.0)
    body = []
    n = 0  # 정본(114:15593) 번호(①②…) — 렌더되는 마커에 순차 부여
    if tier == "low":
        fig = [a for a in anns if a["anchor"]["kind"] in _FIGURE_KINDS]
        rest = [a for a in anns if a["anchor"]["kind"] not in _FIGURE_KINDS]
        if fig:
            reg = _union_region([a["anchor"] for a in fig])
            body.append(_coarse_region(reg, width, height, accent, s))
            body.append(
                _label_stack(reg, [a["label"] for a in fig], width, height, accent, s)
            )
        for a in rest:
            n += 1
            body.append(_render(a, width, height, accent, num=n, s=s))
    else:  # ok / fail
        for a in anns:
            n += 1
            body.append(_render(a, width, height, accent, num=n, s=s))

    return _wrap(width, height, "\n".join(b for b in body if b))


def _wrap(w, h, inner):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" font-family="-apple-system, system-ui, sans-serif">\n'
        f"{inner}\n</svg>"
    )


def _pill(x, y, text, accent, anchor="start", s=1.0):
    t = escape(str(text))
    pad, fs = 7 * s, 13 * s
    wpx = pad * 2 + len(t) * 7.4 * s  # 대략 폭(한글 폭 보정)
    bx = x if anchor == "start" else x - wpx
    return (
        f'<g><rect x="{bx:.1f}" y="{y - 18 * s:.1f}" rx="{9 * s:.1f}" ry="{9 * s:.1f}" '
        f'width="{wpx:.1f}" height="{20 * s:.1f}" fill="{accent}"/>'
        f'<text x="{bx + pad:.1f}" y="{y - 4 * s:.1f}" font-size="{fs:.1f}" '
        f'fill="#fff">{t}</text></g>'
    )


def _num_badge(x, y, n, accent, s=1.0):
    """정본(114:15593) 마커: 채운 주황 원 + 흰 숫자(①②…). 그림 위 개선 포인트 지시.
    크기는 이미지 비례(s) — 큰 원본이 축소돼도 표시 크기 일정."""
    r, fs = 11 * s, 13 * s
    return (
        f'<g><circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{accent}"/>'
        f'<text x="{x:.1f}" y="{y + 4.5 * s:.1f}" font-size="{fs:.1f}" font-weight="700" '
        f'fill="#fff" text-anchor="middle">{n}</text></g>'
    )


def _render(a, w, h, accent, num=1, s=1.0):
    """정본: 각 개선 포인트를 번호 badge(원형) + 간단 텍스트 라벨로. (화살표 없음 — 114:15593)
    s = 이미지 비례 스케일(build_overlay 계산)."""
    k = a["anchor"]["kind"]
    lbl = a["label"]
    if k == "point":
        x, y = a["anchor"]["x"] * w, a["anchor"]["y"] * h
        return _num_badge(x, y, num, accent, s) + _pill(
            x + 16 * s, y + 2 * s, lbl, accent, s=s
        )
    if k == "region":
        x0, y0 = a["anchor"]["x0"] * w, a["anchor"]["y0"] * h
        x1, y1 = a["anchor"]["x1"] * w, a["anchor"]["y1"] * h
        rect = (
            f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{x1 - x0:.1f}" height="{y1 - y0:.1f}" '
            f'rx="{6 * s:.1f}" fill="none" stroke="{accent}" stroke-width="{2 * s:.1f}"/>'
        )
        return (
            rect
            + _num_badge(x0 + 2 * s, y0 + 2 * s, num, accent, s)
            + _pill(x0 + 18 * s, y0 + 4 * s, lbl, accent, s=s)
        )
    if k == "hline":
        y = a["anchor"]["y"] * h
        line = (
            f'<line x1="0" y1="{y:.1f}" x2="{w}" y2="{y:.1f}" stroke="{accent}" '
            f'stroke-width="{2 * s:.1f}" stroke-dasharray="8 6"/>'
        )
        return (
            line
            + _num_badge(w - 16 * s, y, num, accent, s)
            + _pill(w - 32 * s, y + 2 * s, lbl, accent, anchor="end", s=s)
        )
    # image: 전역 축 — 코너에 번호 badge + 라벨(은은하게)
    yy = (24 + (num - 1) * 28) * s
    return _num_badge(20 * s, yy, num, accent, s) + _pill(
        36 * s, yy + 2 * s, lbl, accent, s=s
    )


def _union_region(anchors, pad=0.04):
    xs0, ys0, xs1, ys1 = [], [], [], []
    for a in anchors:
        if a["kind"] == "region":
            xs0.append(a["x0"])
            ys0.append(a["y0"])
            xs1.append(a["x1"])
            ys1.append(a["y1"])
        elif a["kind"] == "point":
            xs0.append(a["x"])
            ys0.append(a["y"])
            xs1.append(a["x"])
            ys1.append(a["y"])
    x0 = max(0.0, min(xs0) - pad)
    y0 = max(0.0, min(ys0) - pad)
    x1 = min(1.0, max(xs1) + pad)
    y1 = min(1.0, max(ys1) + pad)
    return (x0, y0, x1, y1)


def _coarse_region(reg, w, h, accent, s=1.0):
    x0, y0, x1, y1 = reg[0] * w, reg[1] * h, reg[2] * w, reg[3] * h
    return (
        f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{x1 - x0:.1f}" height="{y1 - y0:.1f}" '
        f'rx="{14 * s:.1f}" fill="{accent}" fill-opacity="0.12" stroke="{accent}" '
        f'stroke-width="{2 * s:.1f}" stroke-dasharray="3 5"/>'
    )


def _label_stack(reg, labels, w, h, accent, s=1.0):
    x0, y0 = reg[0] * w, reg[1] * h
    parts = [_pill(x0, y0, "대략 이 부근", accent, s=s)]
    for i, lbl in enumerate(labels):
        parts.append(_pill(x0, y0 + (24 + i * 24) * s, lbl, accent, s=s))
    return "".join(parts)


# ── 모드 선택(이론 vs 오버레이) ───────────────────────────────────────────────────────────────
def select_visual_mode(observations, growth):
    """이론(공유 도식) vs 오버레이(그림 위) 축 분배.
    규칙: 처음(cold/이력 없음)이거나 · 사용자에게 신규 축이거나 · 이번 그림에서 못 잰 축 → 이론.
          반복(steady/recurring) + 측정된 축 → 오버레이. (배타적 아님: 이론 도식은 항상 가능.)
    growth = growth_context 결과(steady·recurring·cold). 전부 이미 계산되는 값."""
    growth = growth or {}
    seen = set(growth.get("steady") or []) | set(growth.get("recurring") or [])
    first_time = bool(growth.get("cold")) or not seen
    theory, overlay = [], []
    for o in observations:
        sp = o.get("sub_problem")
        if first_time or sp not in seen or not o.get("measured"):
            theory.append(sp)
        else:
            overlay.append(sp)
    return {"theory_axes": theory, "overlay_axes": overlay, "first_time": first_time}
