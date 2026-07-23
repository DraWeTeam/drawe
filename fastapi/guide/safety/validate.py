import logging
import re
from pydantic import ValidationError
from guide.schemas import GuideResponse, GuideBlock

log = logging.getLogger("drawe-fastapi.guide.safety.validate")


class Grounding(Exception):
    pass


class Policy(Exception):
    pass


FORBIDDEN = re.compile(
    r"(초보|실력|등급|점수|재능 ?없|잘 그렸|못 그렸|대신 그려|정답 ?이미지)"
)


def validate_guide(raw_json, diagnosis, retrieved_ids, taxonomy_ids):
    g = GuideResponse.model_validate_json(raw_json)  # 1) 스키마
    if g.mode != "coach":
        return g
    obs = {o["sub_problem"]: o["confidence"] for o in diagnosis["observations"]}
    if g.primary_focus not in taxonomy_ids:
        raise Grounding(f"primary_focus '{g.primary_focus}' not in taxonomy")
    for b in g.blocks:  # 2) 닫힌 세계(근거)
        if b.sub_problem not in obs:
            raise Grounding(f"unknown sub_problem '{b.sub_problem}'")
        invented = [r for r in b.reference_ids if r not in retrieved_ids]
        if invented:
            raise Grounding(f"invented refs {invented}")
        if b.confidence > obs[b.sub_problem] + 0.1:
            b.confidence = obs[b.sub_problem]
        if diagnosis["degraded"]:
            b.confidence = min(b.confidence, 0.4)
    text = " ".join(
        [b.observation + b.effect + b.direction for b in g.blocks]
        + [g.synthesis or "", g.one_thing or "", g.next_steps_note or ""]
    )
    if FORBIDDEN.search(text):  # 3) 정책 표현
        raise Policy("forbidden phrasing")
    return g


def template_fallback(diagnosis, refs_by_sp, taxonomy):
    blocks = []
    for o in diagnosis["observations"]:
        e = taxonomy[o["sub_problem"]]
        blocks.append(
            GuideBlock(
                sub_problem=o["sub_problem"],
                observation=e["what_to_observe"],
                effect=e.get("default_effect", ""),
                direction=e["practice_prompt"],
                reference_ids=[r for r, _ in refs_by_sp.get(o["sub_problem"], [])][:3],
                confidence=min(
                    o["confidence"], 0.4 if diagnosis["degraded"] else o["confidence"]
                ),
            )
        )
    return GuideResponse(
        mode="coach",
        primary_focus=diagnosis["primary_focus"],
        degraded=diagnosis["degraded"],
        blocks=blocks,
        one_thing=(blocks[0].direction if blocks else None),
    )


def _set_refs(g, refs_by_sp):
    """레퍼런스는 검색이 결정한다(LLM은 이미지를 못 보므로 고를 수 없음).
    각 블록을 해당 sub_problem의 검색 상위 3개로 설정 → LLM이 reference_ids를
    빠뜨리거나 일부만 담아도 일관되게 채워진다. 설정값은 retrieved 집합이라 근거 규칙 안전."""
    if g.mode != "coach":
        return g
    for b in g.blocks:
        b.reference_ids = [r for r, _ in refs_by_sp.get(b.sub_problem, [])][:3]
    return g


_NORM_RE = re.compile(r"[^0-9a-z가-힣]")


def _norm(s):
    return _NORM_RE.sub("", (s or "").lower())


def _too_similar(a, b, thresh=0.6):
    """두 문장이 '사실상 같은 말'인지(공백·문장부호·어미 차이 무시). 부분포함 또는 글자 bigram Jaccard."""
    na, nb = _norm(a), _norm(b)
    if len(na) < 6 or len(nb) < 6:
        return False
    if na in nb or nb in na:
        return True
    A = {na[i : i + 2] for i in range(len(na) - 1)}
    B = {nb[i : i + 2] for i in range(len(nb) - 1)}
    if not A or not B:
        return False
    return len(A & B) / len(A | B) >= thresh


def strip_redundant_text(g):
    """렌더에서 인트로·추천연습·한끗포인트가 같은 문장으로 겹쳐 보이는 걸 막는다(LLM 비결정성 보험).
    기준 텍스트는 focus_practice(추천 연습, 결정적). 그와 거의 같은 note/direction 을 비워 한 번만 보이게."""
    if g.mode != "coach":
        return g
    ns = g.next_steps
    fp = getattr(ns, "focus_practice", None) if ns else None
    if not fp:
        return g
    # 인트로(note)가 연습을 되풀이 → 비움(렌더가 synthesis 개념으로 폴백)
    if ns and getattr(ns, "note", None) and _too_similar(ns.note, fp):
        ns.note = None
    # 한 끗 포인트(primary.direction)가 연습과 ≈같음 → 텍스트 비움(도식만 남김)
    if g.blocks:
        b0 = g.blocks[0]
        if getattr(b0, "direction", None) and _too_similar(b0.direction, fp):
            b0.direction = ""
    return g


def coach_with_guardrails(
    prompt, diagnosis, refs_by_sp, retrieved_ids, taxonomy, llm, max_retries=2
):
    tax_ids = set(taxonomy)
    last_err = None
    for _ in range(max_retries + 1):
        raw = llm.complete_json(prompt, step="coach")
        try:
            g = validate_guide(raw, diagnosis, retrieved_ids, tax_ids)
            return _set_refs(g, refs_by_sp)
        except (ValidationError, Grounding, Policy) as e:
            last_err = e
            prompt += f"\n[수정 필요] {e}. 스키마와 근거(주어진 sub_problem·ref만)를 지켜 다시."
    # 왜 LLM 출력이 거부됐는지 한 줄 남김: Policy=금지표현, Grounding=근거(ref/sub_problem), ValidationError=스키마
    log.warning(
        f"[guide] 검증 탈락 {max_retries + 1}회 → 템플릿 폴백: {type(last_err).__name__}: {last_err}"
    )
    return template_fallback(diagnosis, refs_by_sp, taxonomy)
