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


def _josa(word, jong, no_jong):
    """한글 받침 유무로 조사 선택(예: 이/가). 결정론 발화라 조사도 맞춘다('손 구조가'/'명암이')."""
    if not word:
        return no_jong
    c = ord(word[-1])
    if 0xAC00 <= c <= 0xD7A3:  # 한글 음절 → 종성(받침) 있으면 jong
        return jong if (c - 0xAC00) % 28 else no_jong
    return no_jong


def _chat_feedback(guide, user_focus):
    """채팅용 '이 그림 한 줄 피드백'을 *결정론적*으로 조립한다(LLM 안 씀, 성장 없음).

    설계 3층:
      L1 intent  = user_focus(= routes 가 detect_terms(message)로 뽑은 *명시 입력* 키워드 축).
                   판단어("괜찮다/이상해요")는 어느 축에도 매핑 안 돼 자동 탈락 → 진단을 못 바꾼다.
                   ★diagnose 의 from_user 가 아니라 순수 텍스트 키워드를 쓴다 — from_user 는 subject
                   에스컬레이션(손 이미지→hand)까지 섞여 mismatch 를 (A)로 삼키기 때문.
      L2 align   = 사용자 관심 축 vs 진단 primary 관계: aligned / mismatch / none.
      L3 render  = 케이스별 결정론 문형.
    ★진단 불변: diag_line 은 *이미지가 만든* primary 관찰(blocks[0].observation)만 쓴다. user_text 는
      '어느 축을 인정하며 진입할지'(프레이밍)만 정하고 진단 내용·축을 못 바꾼다. '하나 중심' = primary 한 축만.
    """
    blocks = guide.blocks or []
    if not blocks:
        return None
    primary = blocks[0]  # 하나 중심: primary 축만 (top-3 나열 금지)
    diag_line = (primary.observation or "").strip()
    if not diag_line:
        return None
    focus = list(user_focus or [])
    if not focus:
        # (C) none — 관심 축 없음(판단어/오프토픽/무키워드). 질문 인정하듯 가볍게 진단으로 잇는다.
        #   무라벨 지시어형(라벨 재명명 중복 회피). diag_line 은 그대로(축·진단 불변).
        return f"찬찬히 보니 — {diag_line}"
    if primary.sub_problem in focus:
        # (A) aligned — 물은 축이 곧 진단 primary → 관찰이 곧 답. 라벨 반복 없이 인정만 얹는다
        #   ("입체"=value 처럼 관심축==진단축이라 '관심→진단' 다리는 동어반복 → 인정형).
        return f"네, 바로 그 부분이에요 — {diag_line}"
    # (B) mismatch — 사용자 관심 축을 인정하되, 진단 primary 로 정직하게 우선순위를 잡는다.
    ulabels = [LABELS[sp] for sp in focus if sp in LABELS]
    plabel = LABELS.get(primary.sub_problem)
    if not ulabels or not plabel:
        return diag_line  # 라벨 없으면 프레이밍 생략, 진단만(안전)
    return (
        f"{ulabels[0]} 궁금하셨죠. 다만 지금 이 그림에선 "
        f"{plabel}{_josa(plabel, '이', '가')} 먼저 눈에 띄어요 — {diag_line}"
    )


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
    user_focus=(),
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
        # 채팅 한 줄 피드백(결정론) — 성장 없이 '이 그림 진단 + 사용자 의도 진입'. 상세 synthesis/growth 는 불변.
        g.chat_feedback = _chat_feedback(g, user_focus)
    return g
