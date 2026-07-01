import re

from guide.prompts import build_coach_prompt
from guide.safety.validate import coach_with_guardrails, strip_redundant_text
from guide.schemas import GuideResponse, NextSteps, GuideAsset
from guide.pipeline import assets
from guide.pipeline.roadmap import LABELS


def _relabel_ids(text):
    """LLM이 '앞으로 할 것' 자연 문장에 그대로 박은 raw axis-id(예: 'foreshortening을 살펴본 뒤')를
    한글 라벨로 치환. LABELS 단일 출처 재사용, 표시 문자열만 손댐(진단 로직 무관). 긴 id 우선
    치환(facial_proportion → proportion 부분매칭 방지). 한 축만 땜질 말고 전 축 일괄 보장."""
    if not text:
        return text
    # 경계는 ascii id 문자([A-Za-z_])로만 판정한다. \b 는 한글 조사가 붙으면(예: "foreshortening을")
    #   'g'↔'을' 사이를 단어경계로 안 봐서 매칭 실패 → id 앞뒤가 ascii id 문자가 아닐 때만 치환.
    #   긴 id 우선(facial_proportion 이 proportion 으로 부분치환되지 않게).
    for aid in sorted(LABELS, key=len, reverse=True):
        text = re.sub(rf"(?<![A-Za-z_]){re.escape(aid)}(?![A-Za-z_])", LABELS[aid], text)
    return text


def _next_steps(growth, taxonomy):
    """'앞으로 할 것' 블록을 로드맵 컨텍스트 + taxonomy로 결정적으로 구성(LLM 아님)."""
    if not growth or not growth.get("current_focus"):
        return None
    focus = growth.get("current_focus")
    nxt = growth.get("next_goal")
    fe = taxonomy.get(focus, {}) if focus else {}
    ne = taxonomy.get(nxt, {}) if nxt else {}
    return NextSteps(
        focus=focus,
        focus_practice=fe.get("practice_prompt"),
        next_goal=nxt,
        next_goal_practice=ne.get("practice_prompt"),
        recurring=growth.get("recurring", []),
        why=growth.get("why"),
    )


def run_guide(
    diagnosis,
    refs_by_sp,
    retrieved_ids,
    taxonomy,
    llm,
    growth=None,
    intent="open",
    asset_index=None,
):
    if diagnosis.get("primary_focus") is None:
        return GuideResponse(mode="clarify", message="무엇을 봐주면 좋을지 알려주세요.")
    ns = _next_steps(
        growth, taxonomy
    )  # 결정적(무엇을 할지) — 먼저 계산해 프롬프트에 '사실'로 넣는다
    prompt = build_coach_prompt(
        diagnosis, refs_by_sp, intent=intent, growth=growth, next_steps=ns
    )
    g = coach_with_guardrails(
        prompt, diagnosis, refs_by_sp, retrieved_ids, taxonomy, llm
    )
    # next_steps · guide_asset 는 가드레일 '뒤'에서 코드가 결정적으로 채운다(LLM이 못 지어내게; _set_refs와 같은 패턴).
    if g.mode == "coach":
        degraded = bool(diagnosis.get("degraded"))
        idx = asset_index or {}
        # 블록마다 설명 자료 1개(축별 선호 + 적용가능성 + 후보 밖 차단). 적재 인덱스 없으면 svg 도식 바닥으로 폴백.
        for b in g.blocks:
            b.guide_asset = GuideAsset(
                **assets.pick(
                    b.sub_problem, loaded=idx.get(b.sub_problem), degraded=degraded
                )
            )
        # LLM 이 *배열*한 자연 문장이 가드레일을 통과했으면 note 로 옮긴다(없으면 구조 필드로 폴백).
        #   LLM 이 관찰의 raw sub_problem id 를 문장에 그대로 박는 경우가 있어(예: "foreshortening을
        #   살펴본 뒤") 한글 라벨로 정규화한다 — LABELS 안 거치던 유일 narration 경로 보정.
        if g.next_steps_note:
            g.next_steps_note = _relabel_ids(g.next_steps_note)
        if ns and g.next_steps_note:
            ns.note = g.next_steps_note
        g.next_steps = ns
        # '앞으로 키울 것'의 집중 축에도 같은 자료 슬롯을 결정적으로 붙인다(완성작/연속성 패널의 설명).
        if g.next_steps and g.next_steps.focus:
            g.next_steps.focus_asset = GuideAsset(
                **assets.pick(
                    g.next_steps.focus,
                    loaded=idx.get(g.next_steps.focus),
                    degraded=degraded,
                )
            )
        # 완성작인데 LLM이 one_thing을 비워 보냈으면, '이번에 딱 하나'를 성장 방향으로 채운다.
        if intent == "finished" and not g.one_thing and g.next_steps:
            g.one_thing = g.next_steps.focus_practice
        # 렌더 중복 가드(보험): 인트로·추천연습·한끗포인트가 같은 문장으로 겹치면 비워 한 번만 보이게.
        g = strip_redundant_text(g)
    return g
