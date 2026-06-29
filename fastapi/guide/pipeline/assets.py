"""Grounded guide-asset 선택 — 각 관찰(블록)에 붙일 '설명 자료'를 후보 중에서 고른다.

레퍼런스(실제 참고작) 선택과 *같은 그라운딩 패턴*의 '자료 채널 하나 더'다. 불변식은 agent.py와 동형:
  • 룰이 소유 : 축별 자료 후보 집합(미리 적재된 ai_example·backbone_3d + 축마다 *항상* 생성 가능한 svg 도식 바닥).
  • 정책이 소유 : 그 후보 *안에서의* type 선택(축별 선호 순서 + 적용가능성).
  • 절대 못 함  : 후보 밖 자료를 지어내기 / 측정 안 한 축에 자료를 '참고작'인 양 붙이기.

안전 속성 두 가지(둘 다 그라운딩 서사를 지킨다):
  1) svg 도식은 축마다 *항상* 만들 수 있는 바닥 → 슬롯이 비거나 환각될 일이 없다(레퍼런스의 degraded 폴백과 동형).
  2) 해부·손·비율처럼 AI가 자주 틀리는 축에는 ai_example을 *후보에서 제외* → 초보자에게 잘못된 형태를 권하지 않는다.

한 번에 자료는 *하나만*(type 라벨 동봉). UI는 type을 보고 렌더만 바꾸고, 'type 스왑'으로 다른 후보를 보여줄 수 있다.
스키마로는 GuideBlock/NextSteps 에 guide_asset:{type,ref_id,label,caption} 한 필드가 추가될 뿐 — 새 파이프라인이 아니다.
"""

from guide.pipeline.profiles import POSE_DEPENDENT

SVG = "svg"
AI = "ai_example"
BACKBONE = "backbone_3d"

# 사용자에게 '무엇을 보고 있는지' 알려 신뢰 서사를 보호하는 라벨(결정적 도해 / 기하 참고 / AI 일러스트).
TYPE_LABEL = {SVG: "도식", AI: "AI 예시", BACKBONE: "3D 참고"}

# 축별 선호 순서(적재된 *비-바닥* type 중에서 고를 우선순위). 어느 것도 없으면 svg 도식 바닥으로 떨어진다.
#   - 단축·무게·관절·비율(입체/기하가 핵심) : 3D 백본이 가장 신뢰. 그 다음 svg 도식.
#   - 명암·구도(방법이 명확)               : svg 방법 도해 우선, 없으면 AI 느낌 예시.
#   - 빛 방향·색(느낌이 핵심)              : AI 일러스트가 강함, 없으면 svg.
#   - 손(AI가 가장 자주 틀림)              : svg 도식만(AI·확신형 3D 배제).
AXIS_PREF = {
    "foreshortening": [BACKBONE, SVG],
    "weight_balance": [BACKBONE, SVG],
    "joint_articulation": [BACKBONE, SVG],
    "proportion": [BACKBONE, SVG],
    "action_line": [BACKBONE, SVG],
    # 얼굴 비례(이목구비 배치/눈선) : 손과 동형으로 svg 도식만(AI 얼굴은 형태를 자주 왜곡 → AI_AVOID).
    "facial_proportion": [SVG],
    "hand_structure": [SVG],
    "value_structure": [SVG, AI],
    "composition_balance": [SVG, AI],
    "light_direction": [AI, SVG],
    "color_harmony": [AI, SVG],
    # 풍경 전용 축: 원근/지평선은 svg 도해, 대기원근·깊이는 AI 일러스트가 느낌을 잘 보여줌.
    "linear_perspective": [SVG],
    "horizon_placement": [SVG],
    "atmospheric_perspective": [AI, SVG],
    "depth_layering": [SVG, AI],
}
_DEFAULT_PREF = [SVG]  # 모르는 축도 svg 바닥으로 안전하게 동작

# AI가 형태를 자주 틀리는 축 — ai_example을 *후보에서 제외*한다(있어도 안 붙임). 해부·손·비율.
AI_AVOID = {
    "hand_structure",
    "joint_articulation",
    "foreshortening",
    "proportion",
    "facial_proportion",  # 얼굴·이목구비도 AI가 자주 왜곡 → 초보에게 잘못된 형태 권하지 않게 ai_example 제외.
    "weight_balance",
}

# 축마다 항상 가능한 svg 도식 바닥의 설명(방법/도해). 없는 축은 일반 격자 도해로 폴백.
_FLOOR_CAPTION = {
    "weight_balance": "골반 중심에서 바닥으로 수직선을 하나 그어보세요 — 두 발 사이를 지나가면 안정적으로 읽혀요.",
    "hand_structure": "손을 손바닥(상자)+손가락 덩어리로 먼저 잡으세요 — 손바닥은 얼굴만 하고 손가락 길이도 손바닥과 비슷해요. 손가락은 마디 3개로 끝으로 갈수록 짧아지고, 엄지는 더 짧고 마디 2개로 옆으로 벌어집니다.",
    "joint_articulation": "관절을 원, 뼈를 선으로 먼저 잡아보세요 — 꺾이는 방향이 분명해지면 포즈가 살아나요.",
    "value_structure": "명암을 밝음·중간·어둠 3단계로 묶어 보는 도식이에요.",
    "composition_balance": "화면을 3분할해 무게가 어디로 쏠리는지 보는 썸네일 격자예요.",
    "proportion": "머리 하나를 자로 키가 몇 등신인지 재고, 어깨·허리·골반(키½)·무릎(다리½)·발이 머리 몇 개 위치인지 점만 찍어보세요. 절대 등신을 단정하지 말고 의도한 스타일 밴드(데포르메 4~5·캐주얼 6~7·사실 8)에 맞는지로 보세요.",
    "facial_proportion": "머리를 공+턱 한 덩어리로 보고 눈선을 머리끝~턱의 한가운데에 먼저 그어요 — 좌우 눈·귀가 이 선에 맞으면 인상이 안정돼요.",
    "foreshortening": "면이 시점으로 줄어드는 정도를 보는 투시 격자예요.",
    "action_line": "포즈를 관통하는 하나의 큰 흐름(동세 선)을 보는 도식이에요.",
    "light_direction": "광원 한 개에서 면이 받는 빛의 방향을 보는 도식이에요.",
    "color_harmony": "색상환에서 쓰는 색들의 관계를 보는 도식이에요.",
    "linear_perspective": "선들이 한 소실점으로 모이는 원근 격자 도식이에요.",
    "horizon_placement": "지평선을 화면 위·아래 1/3에 두는 배치 도식이에요.",
    "atmospheric_perspective": "거리에 따라 대비·채도가 옅어지는 깊이 도식이에요.",
    "depth_layering": "근·중·원경 세 층으로 공간을 나눠 보는 도식이에요.",
}
_GENERIC_CAPTION = "이 부분을 어떻게 나눠 보는지 도해로 정리한 예시예요."


def floor_asset(sp):
    """축마다 항상 존재하는 svg 도식 바닥(슬롯이 절대 비지 않게 하는 폴백)."""
    return {
        "type": SVG,
        "ref_id": f"floor:{sp}",
        "label": TYPE_LABEL[SVG],
        "caption": _FLOOR_CAPTION.get(sp, _GENERIC_CAPTION),
    }


# 축별 항상-가능한 도식 SVG(서빙용). 적재 자료가 0개여도 슬롯이 실제 그림을 가진다는 보증.
_INK, _SUB = "#3a3a3a", "#9aa0a6"
_FLOOR_SVG = {
    "value_structure": '<rect x="20" y="40" width="60" height="80" fill="#f2f2f2" stroke="{i}"/>'
    '<rect x="80" y="40" width="60" height="80" fill="#9a9a9a" stroke="{i}"/>'
    '<rect x="140" y="40" width="60" height="80" fill="#2b2b2b" stroke="{i}"/>'
    '<text x="110" y="150" text-anchor="middle" fill="{s}" font-size="13">밝음 · 중간 · 어둠</text>',
    "composition_balance": '<rect x="30" y="30" width="180" height="120" fill="none" stroke="{i}"/>'
    '<line x1="90" y1="30" x2="90" y2="150" stroke="{s}" stroke-dasharray="4"/>'
    '<line x1="150" y1="30" x2="150" y2="150" stroke="{s}" stroke-dasharray="4"/>'
    '<line x1="30" y1="70" x2="210" y2="70" stroke="{s}" stroke-dasharray="4"/>'
    '<line x1="30" y1="110" x2="210" y2="110" stroke="{s}" stroke-dasharray="4"/>'
    '<circle cx="150" cy="70" r="6" fill="{i}"/>',
    # 비례 = 머리-단위 눈금(1~6) + 랜드마크 위치. 문서(영역1) 칸분할 머리1·가슴1·골반1·허벅지1.5·종아리1.5=6등신,
    # 골반(다리 시작)=키½·무릎=다리½는 문서 명시값, 어깨·허리는 칸분할 역산(문서 파생). 절대 등신은 스타일 밴드로만 판정.
    "proportion": "".join(
        f'<line x1="38" y1="{18 + h * 22}" x2="150" y2="{18 + h * 22}" stroke="{{s}}" stroke-dasharray="3"/>'
        f'<text x="22" y="{22 + h * 22}" fill="{{s}}" font-size="10">{h}</text>'
        for h in range(1, 7)
    )
    + '<line x1="95" y1="40" x2="95" y2="150" stroke="{s}"/>'
    + '<ellipse cx="95" cy="29" rx="10" ry="11" fill="none" stroke="{i}"/>'
    + '<line x1="78" y1="40" x2="112" y2="40" stroke="{i}"/><text x="156" y="44" fill="{i}" font-size="11">어깨</text>'
    + '<line x1="80" y1="62" x2="110" y2="62" stroke="{i}"/><text x="156" y="66" fill="{i}" font-size="11">허리</text>'
    + '<line x1="74" y1="84" x2="116" y2="84" stroke="{i}"/><text x="156" y="88" fill="{i}" font-size="11">골반·½키</text>'
    + '<line x1="80" y1="117" x2="110" y2="117" stroke="{i}"/><text x="156" y="121" fill="{i}" font-size="11">무릎·½다리</text>'
    + '<line x1="80" y1="150" x2="110" y2="150" stroke="{i}"/><text x="156" y="147" fill="{i}" font-size="11">발</text>'
    + '<text x="10" y="174" fill="{i}" font-size="9">데포르메 4·5  캐주얼 6·7  사실 8</text>',
    # 얼굴 비례 = 머리(공+턱) 한 덩어리 + 눈선이 머리끝~턱의 정중앙(½)에 놓이는 도식. 좌우 눈을 그 선에 대칭으로.
    "facial_proportion": '<ellipse cx="120" cy="90" rx="48" ry="65" fill="none" stroke="{i}"/>'
    '<line x1="120" y1="25" x2="120" y2="155" stroke="{s}" stroke-dasharray="4"/>'
    '<line x1="58" y1="90" x2="182" y2="90" stroke="{i}"/>'
    '<ellipse cx="104" cy="90" rx="9" ry="4" fill="none" stroke="{i}"/>'
    '<ellipse cx="136" cy="90" rx="9" ry="4" fill="none" stroke="{i}"/>'
    '<line x1="192" y1="25" x2="192" y2="155" stroke="{s}"/>'
    '<line x1="188" y1="25" x2="196" y2="25" stroke="{s}"/>'
    '<line x1="188" y1="90" x2="196" y2="90" stroke="{s}"/>'
    '<line x1="188" y1="155" x2="196" y2="155" stroke="{s}"/>'
    '<text x="200" y="62" fill="{s}" font-size="10">1/2</text>'
    '<text x="200" y="126" fill="{s}" font-size="10">1/2</text>'
    '<text x="22" y="94" fill="{i}" font-size="11">눈선</text>',
    "foreshortening": '<polygon points="40,40 200,60 200,120 40,140" fill="none" stroke="{i}"/>'
    + "".join(
        f'<line x1="{40 + i * 40}" y1="{40 + i * 5}" x2="{40 + i * 40}" y2="{140 - i * 5}" stroke="{{s}}"/>'
        for i in range(1, 4)
    ),
    # 손 구조(영역5 문서): 손바닥(상자)=얼굴 세로 / 손가락 길이≈손바닥 / 손가락 마디 3개·끝으로 짧아짐 /
    #   엄지 더 짧고 마디 2개·옆 90°로 벌어짐 / 중지 최장·새끼 최단. 얼굴 타원으로 손바닥 크기 비교.
    "hand_structure": '<ellipse cx="34" cy="120" rx="20" ry="27" fill="none" stroke="{s}"/>'
    '<text x="34" y="124" text-anchor="middle" fill="{s}" font-size="11">얼굴</text>'
    '<rect x="92" y="92" width="74" height="56" rx="6" fill="none" stroke="{i}"/>'
    '<text x="129" y="124" text-anchor="middle" fill="{i}" font-size="11">손바닥</text>'
    + "".join(
        f'<line x1="{x}" y1="92" x2="{x}" y2="{tip}" stroke="{{i}}"/>'
        f'<line x1="{x - 5}" y1="{tip + (92 - tip) // 3}" x2="{x + 5}" y2="{tip + (92 - tip) // 3}" stroke="{{s}}"/>'
        f'<line x1="{x - 5}" y1="{tip + 2 * (92 - tip) // 3}" x2="{x + 5}" y2="{tip + 2 * (92 - tip) // 3}" stroke="{{s}}"/>'
        for x, tip in ((104, 52), (121, 42), (138, 50), (155, 62))
    )
    + '<text x="129" y="34" text-anchor="middle" fill="{s}" font-size="10">마디 3</text>'
    + '<line x1="92" y1="126" x2="75" y2="133" stroke="{i}"/>'
    + '<line x1="75" y1="133" x2="64" y2="129" stroke="{i}"/>'
    + '<text x="62" y="150" text-anchor="middle" fill="{s}" font-size="10">엄지 2</text>',
}
_GENERIC_SVG = (
    '<rect x="40" y="40" width="160" height="100" fill="none" stroke="{i}"/>'
    '<line x1="40" y1="90" x2="200" y2="90" stroke="{s}" stroke-dasharray="4"/>'
    '<line x1="120" y1="40" x2="120" y2="140" stroke="{s}" stroke-dasharray="4"/>'
)


def floor_svg(sp):
    """그 축의 도식 SVG 문자열(라우트가 그대로 서빙). 어떤 축도 최소한 일반 격자 도해는 항상 나온다."""
    body = _FLOOR_SVG.get(sp, _GENERIC_SVG).format(i=_INK, s=_SUB)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180" '
        f'width="240" height="180" role="img">{body}</svg>'
    )


def gather_candidates(sp, loaded=None, degraded=False):
    """이 sub_problem의 자료 후보를 모은다 = (적재 자료 ∩ 안전 규칙) + svg 도식 바닥.

    loaded: 미리 적재·인덱싱된 자료 dict 리스트([{type, ref_id, label?, caption?}, ...]) 또는 None(아직 없음).
      안전 규칙으로 거른다:
        • AI_AVOID 축의 ai_example 은 제외(잘못된 형태 권유 방지).
        • degraded(전신 미검출) + 포즈 의존 축의 backbone_3d 는 제외(측정 못 한 전신 포즈를 확신형으로 보여주지 않음).
      바닥(svg 도식)은 항상 마지막 후보로 포함 → 후보가 비는 일이 없다.
    """
    out = []
    for a in loaded or []:
        t = a.get("type")
        if t == AI and sp in AI_AVOID:
            continue
        if t == BACKBONE and degraded and sp in POSE_DEPENDENT:
            continue
        if t not in (SVG, AI, BACKBONE):
            continue
        out.append(
            {
                "type": t,
                "ref_id": a["ref_id"],
                "label": a.get("label") or TYPE_LABEL[t],
                "caption": a.get("caption", ""),
            }
        )
    out.append(floor_asset(sp))  # 바닥은 항상 후보(마지막)
    return out


def select_for(sp, candidates):
    """축별 선호 순서대로, 적재된(=바닥 아님) type을 먼저 고른다. 선호 type이 적재돼 있지 않으면 svg 도식 바닥.

    바닥은 '마지막 수단'이라 적재 후보보다 절대 앞서지 않는다(svg가 선호 1순위여도, 적재 svg가 없으면
    AI 같은 다음 선호를 먼저 시도한 뒤에야 바닥으로 떨어진다 → 느낌 예시가 영영 안 뜨는 일이 없음).
    """
    if not candidates:
        return floor_asset(sp)
    loaded_by_type = {}
    floor = None
    for c in candidates:
        if c["ref_id"].startswith("floor:"):
            floor = c
        else:
            loaded_by_type.setdefault(c["type"], c)
    for t in AXIS_PREF.get(sp, _DEFAULT_PREF):
        if t in loaded_by_type:
            return loaded_by_type[t]
    return floor or floor_asset(sp)


def validate(asset, candidates):
    """grounding 강제 — 고른 자료가 후보 집합 안에 있어야 한다(ref_id 기준). 아니면 None(→ 바닥 폴백)."""
    if not asset:
        return None
    allowed = {c["ref_id"] for c in candidates}
    return asset if asset.get("ref_id") in allowed else None


def pick(sp, loaded=None, degraded=False):
    """한 축에 대해 후보 조립 → 선택 → 검증 → (실패 시) 바닥. 항상 grounded 한 자료 하나를 반환."""
    cands = gather_candidates(sp, loaded=loaded, degraded=degraded)
    chosen = validate(select_for(sp, cands), cands)
    return chosen or floor_asset(sp)


def attach(blocks, degraded=False, index=None):
    """코치 블록 각각에 guide_asset 하나를 결정적으로 붙인다(가드레일 '뒤'에서 — LLM이 못 지어냄).

    index(sp -> 적재 자료 리스트)가 있으면 그걸 후보로, 없으면 svg 도식 바닥만으로 동작한다.
    한 블록당 자료는 *하나*(one-at-a-time). 블록 객체에 .guide_asset 을 직접 세팅한다.
    """
    idx = index or {}
    for b in blocks:
        sp = getattr(b, "sub_problem", None) or (
            b.get("sub_problem") if isinstance(b, dict) else None
        )
        if not sp:
            continue
        a = pick(sp, loaded=idx.get(sp), degraded=degraded)
        if isinstance(b, dict):
            b["guide_asset"] = a
        else:
            b.guide_asset = a
    return blocks
