#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
frontend ESLint 에러 3건 수정 — 줄바꿈 무관(LF/CRLF/MIXED 모두 OK) · 멱등.
레포가 LF이므로 결과는 LF로 저장(섞인 줄바꿈도 정리).

  1) react-refresh/only-export-components : axisLabel(+AXIS_LABELS) → guideLabels.js 분리
  2) react-hooks/set-state-in-effect ×2   : effect 내 setState → 렌더 중 prev-key 비교 패턴
경고 4건(exhaustive-deps)은 기존 파일·error 아님 → CI 안 막음(미수정).

적용 순서: 이 스크립트 → npm run format → npm run lint → npm run build
사용법(frontend 디렉터리에서): python apply_frontend_lint_fixes.py
"""
import sys
from pathlib import Path

CHAT = Path("src/pages/chat")

GUIDE_LABELS_JS = "\n".join([
    "// 축 id → 사용자 노출 한글 라벨. 시안 표기에 맞춤(명암 대비/무게중심/구도·균형 등).",
    "// taxonomy 에는 짧은 라벨이 없어 여기서 큐레이션해 들고 간다.",
    "const AXIS_LABELS = {",
    '  weight_balance: "무게중심",',
    '  foreshortening: "단축",',
    '  proportion: "비율",',
    '  action_line: "동세선",',
    '  joint_articulation: "관절",',
    '  hand_structure: "손 구조",',
    '  value_structure: "명암 대비",',
    '  composition_balance: "구도·균형",',
    '  color_harmony: "색 조화",',
    '  light_direction: "광원 방향",',
    '  linear_perspective: "선원근",',
    '  atmospheric_perspective: "대기원근",',
    '  depth_layering: "깊이층",',
    '  horizon_placement: "지평선",',
    "};",
    "",
    'export const axisLabel = (id) => AXIS_LABELS[id] || (id ? id.replace(/_/g, " ") : "");',
    "",
])


def read_lf(p: Path) -> str:
    """줄바꿈 무관: CRLF/CR 을 LF 로 정규화해 읽음."""
    return p.read_bytes().decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


def write_lf(p: Path, text: str):
    """레포 규약(LF)으로 저장."""
    p.write_bytes(text.replace("\r\n", "\n").encode("utf-8"))


def fix_guidemodal(p: Path):
    if not p.is_file():
        print("[WARN] GuideModal.jsx 없음")
        return
    t = read_lf(p)
    orig = t

    # 1) import: useEffect 제거(아래서 둘 다 제거) + guideLabels import 추가
    imp = 'import { useEffect, useState } from "react";'
    if 'import { axisLabel } from "./guideLabels";' in t:
        print("[skip] import — 이미 guideLabels import 있음")
    elif imp in t:
        t = t.replace(imp, 'import { useState } from "react";\nimport { axisLabel } from "./guideLabels";', 1)
        print("[ OK ] import — useEffect 제거 + guideLabels import")
    else:
        print("[ERR ] import 앵커 못 찾음 (react import 형태 확인 필요)")

    # 2) AXIS_LABELS 객체 + axisLabel 정의 제거 (멀티라인 wrap·고아 잔재 모두 안전, 멱등)
    def _cut(text, start_find, end_token):
        s = text.find(start_find)
        if s < 0:
            return text, False
        e = text.find(end_token, s)
        if e < 0:
            return text, False
        e += len(end_token)
        nl = text.find("\n", e)
        ce = nl + 1 if nl >= 0 else len(text)
        if text[ce:ce + 1] == "\n":   # 뒤 빈 줄 1개 흡수
            ce += 1
        return text[:s] + text[ce:], True

    did = False
    # (a) 주석 + const AXIS_LABELS = { ... };
    if "const AXIS_LABELS = {" in t:
        anchor = "// 축 id" if "// 축 id" in t else "const AXIS_LABELS = {"
        t, ok = _cut(t, anchor, "};")
        did = did or ok
    # (b) export const axisLabel = ... ;  (한 줄/여러 줄 wrap 모두 — 끝은 세미콜론)
    if "export const axisLabel" in t:
        t, ok = _cut(t, "export const axisLabel", ";")
        did = did or ok
    # (c) 이전 실행이 남긴 고아 잔재(AXIS_LABELS[id] ... ;)만 있는 경우 — 인덱스 슬라이스
    elif "AXIS_LABELS[id]" in t:
        idx = t.find("AXIS_LABELS[id]")
        ls = t.rfind("\n", 0, idx) + 1            # 그 줄 시작
        e = t.find(";", idx)                       # 문 끝 세미콜론
        if e >= 0:
            nl = t.find("\n", e)
            ce = nl + 1 if nl >= 0 else len(t)
            if t[ce:ce + 1] == "\n":              # 뒤 빈 줄 1개 흡수
                ce += 1
            t = t[:ls] + t[ce:]
            did = True
    if did:
        print("[ OK ] axisLabel 블록/잔재 제거(→ guideLabels.js)")
    elif "AXIS_LABELS" not in t and "export const axisLabel" not in t:
        print("[skip] axisLabel 블록 — 이미 제거됨")
    else:
        print("[ERR ] axisLabel 잔재 처리 실패 — 수동확인")

    # 3) setSel effect → prev-key
    s_old = '  const refKey = (refIds || []).join(",");\n  useEffect(() => setSel(null), [refKey]);'
    s_new = "\n".join([
        '  const refKey = (refIds || []).join(",");',
        "  const [prevRefKey, setPrevRefKey] = useState(refKey);",
        "  if (refKey !== prevRefKey) {",
        "    setPrevRefKey(refKey);",
        "    setSel(null);",
        "  }",
    ])
    if "prevRefKey" in t:
        print("[skip] setSel — 이미 prev-key 적용")
    elif s_old in t:
        t = t.replace(s_old, s_new, 1)
        print("[ OK ] setSel effect → prev-key")
    else:
        print("[ERR ] setSel 앵커 못 찾음 — 수동확인")

    # 4) setRefOffset effect → prev-key
    r_old = '  const poolKey = refPool.join(",");\n  useEffect(() => setRefOffset(0), [poolKey]); // 가이드(풀)가 바뀌면 처음으로'
    r_new = "\n".join([
        '  const poolKey = refPool.join(",");',
        "  const [prevPoolKey, setPrevPoolKey] = useState(poolKey);",
        "  if (poolKey !== prevPoolKey) {",
        "    setPrevPoolKey(poolKey);",
        "    setRefOffset(0); // 가이드(풀)가 바뀌면 처음으로",
        "  }",
    ])
    if "prevPoolKey" in t:
        print("[skip] setRefOffset — 이미 prev-key 적용")
    elif r_old in t:
        t = t.replace(r_old, r_new, 1)
        print("[ OK ] setRefOffset effect → prev-key")
    else:
        print("[ERR ] setRefOffset 앵커 못 찾음 — 수동확인")

    write_lf(p, t)   # 항상 LF 로 저장(섞인 줄바꿈 정리)
    if t == orig:
        print("       (GuideModal 내용 변화 없음 — 줄바꿈만 LF 정규화)")


def fix_chatpage(p: Path):
    if not p.is_file():
        print("[WARN] ChatPage.jsx 없음")
        return
    t = read_lf(p)
    old = 'import { axisLabel, GuideContent } from "./GuideModal";'
    new = 'import { GuideContent } from "./GuideModal";\nimport { axisLabel } from "./guideLabels";'
    if 'import { axisLabel } from "./guideLabels";' in t:
        print("[ OK ] ChatPage — import 이미 분리(줄바꿈 LF 정규화)")
    elif old in t:
        t = t.replace(old, new, 1)
        print("[ OK ] ChatPage — axisLabel import 분리")
    else:
        print("[WARN] ChatPage — import 상태 불명, 수동확인")
    write_lf(p, t)


def fix_guidelabels(p: Path):
    if p.exists():
        write_lf(p, read_lf(p))   # 줄바꿈 LF 정규화
        print("[ OK ] guideLabels.js — 줄바꿈 LF 정규화")
    else:
        write_lf(p, GUIDE_LABELS_JS)
        print("[ OK ] guideLabels.js 생성(LF)")


def main():
    if not CHAT.is_dir():
        sys.exit("[ERR] frontend 디렉터리(src/pages/chat 포함)에서 실행하세요.")
    fix_guidelabels(CHAT / "guideLabels.js")
    fix_guidemodal(CHAT / "GuideModal.jsx")
    fix_chatpage(CHAT / "ChatPage.jsx")
    print("\n다음: npm run format  →  npm run lint  →  npm run build")
    print("(lint 에러 0 기대; exhaustive-deps 경고 4건은 기존·무관)")


if __name__ == "__main__":
    main()
