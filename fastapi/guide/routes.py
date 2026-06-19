from fastapi import APIRouter, UploadFile, Form, Request, HTTPException
from fastapi.responses import StreamingResponse, RedirectResponse
from pydantic import BaseModel
from io import BytesIO
import json
import uuid
import asyncio
from sqlalchemy import text, bindparam

from guide.stores.db import engine
from guide.stores.s3 import presigned_url
from guide.ml.normalize import normalize
from guide.ml.scene import analyze
from guide.ml.pose import extract
from guide.ml.llm import get_llm
from guide.pipeline.coach import run_guide
from guide.schemas import PendingReference
from guide.pipeline.router import resolve, detect_intent
from guide.pipeline.diagnose import diagnose, taxonomy, instrument_version
from guide.pipeline.roadmap import (
    get_roadmap,
    record_practice,
    growth_context,
    _why,
    growth_view,
)
from guide.pipeline.growth_stage import apply_cold_start
from guide.pipeline.profiles import resolve_profile
from guide.pipeline.subject import resolve_subject
from guide.pipeline import agent
from guide.pipeline.asset_index import build_asset_index
from guide.pipeline.search import search_text, is_miss
from guide.pipeline.overlay import (
    select_visual_mode,
    resolve_anchors,
    build_overlay,
)
from guide.pipeline.mapping import log_miss
from guide.pipeline.ai_fallback import start_backfill, job_status as _ref_job_status
from guide.safety.moderation import screen_upload
from guide.ml.upload_guard import UploadRejected
from guide._security import (
    valid_ref_id,
    clean_event,
    clamp_confidence,
    PRACTICE_ACTIONS,
)
from guide.contract import finalize_guide_response, growth_from_raw

router = APIRouter()
llm = get_llm()


# 동기 파이프라인(임베딩·mediapipe·손 VLM·LLM)은 asyncio.to_thread 로 오프로드해 이벤트 루프/헬스체크를
# 비차단으로 둔다. 전역 락은 두지 않는다 — _pipeline 안에 느린 네트워크 호출(growth_context LLM·손 VLM)이
# 있어 락을 걸면 그 I/O 동안 모든 동시 요청이 직렬화돼 Spring 타임아웃이 연쇄된다(검증된 develop 동작으로 복귀).


def _pipeline(
    file_bytes, message, user_id="anon", intent="open", track=None, medium=None
):
    try:
        pil = normalize(
            BytesIO(file_bytes)
        )  # 디코드 전 바이트/픽셀/포맷 한도 강제(upload_guard)
    except UploadRejected as e:
        return None, {
            "mode": "refused",
            "message": "이 이미지는 처리할 수 없어요(크기·형식 제한). 다른 이미지를 올려주세요.",
            "reason": str(e),
        }
    if not screen_upload(pil)["allow"]:
        return None, {
            "mode": "refused",
            "message": "이 업로드는 처리할 수 없어요. 작품 이미지를 올려주세요.",
        }
    scene = analyze(pil)
    pose = extract(scene, pil)
    mode, personas, user_terms = resolve(message, scene)
    if mode == "redirect":
        return None, {
            "mode": "redirect",
            "message": "직접 그려드리진 않지만, 보고 싶은 부분을 알려주면 그 지점과 레퍼런스로 같이 봐줄게요.",
        }
    if mode == "clarify":
        return None, {
            "mode": "clarify",
            "message": "분석할 그림인지, 어떤 점을 봐주면 좋을지 알려주세요.",
        }
    # 그림 단계(완성작/연습): 폼 입력 우선, 없으면 메시지 키워드. 압축 이력(growth)을 진단 랭킹에 흘린다.
    intent = detect_intent(message, explicit=intent)
    # 주제 에스컬레이션: track 없고 CLIP 이 애매할 때만 VLM 1회로 보강(손→hand 축, 풍경→landscape track).
    #   확신/명시면 호출 안 함(레이턴시 0). extra_terms 는 user_terms 와 같은 의도 경로를 탄다.
    track, _extra_terms = resolve_subject(scene, pil, track)
    if _extra_terms:
        user_terms = set(user_terms) | _extra_terms
    # track 프로파일: 명시 track 우선, 없으면 scene(인물 유무)로 자동. 진단 게이팅·norm과 로드맵 커리큘럼에 동시 적용.
    profile = resolve_profile(track, scene)
    growth = growth_context(
        user_id,
        track=track,
        curriculum=profile["curriculum"],
        degraded=(pose.get("status") != "ok"),
        llm=llm,
    )
    dx = diagnose(
        scene, pose, pil, personas, user_terms, growth=growth, profile=profile
    )
    # 콜드스타트(첫 업로드·이력 없음): 로드맵 진입 집중 축을 '그림에서 측정된 약점'으로 교정한다.
    #   업로드 = 진단 + 성장 경로 설정 트리거(멘토링). 이력이 쌓이면 apply_cold_start 는 아무것도 안 바꾼다.
    measured = [o["sub_problem"] for o in dx["observations"] if o.get("measured")]
    growth = apply_cold_start(growth, measured, profile["curriculum"], why_fn=_why)
    tax = taxonomy()
    refs_by_sp, retrieved, pending_by_sp = {}, set(), {}
    for o in dx["observations"]:
        sp = o["sub_problem"]
        persona_hint = tax[sp]["personas"][0]
        # 손 문제엔 손 크롭(region=hand) 우선. 없으면 필터 없이 폴백.
        f = {"region": "hand"} if sp == "hand_structure" else None
        # delta4: medium/track 전달 → 같은 매체·트랙 ai_example 에 soft boost(MEDIUM/TRACK_BOOST).
        hits = search_text(
            o["reference_query"],
            persona_hint,
            filters=f,
            sub_problem=sp,
            track=track,
            medium=medium,
        )
        if not hits and f:
            hits = search_text(
                o["reference_query"],
                persona_hint,
                sub_problem=sp,
                track=track,
                medium=medium,
            )
        # miss(빈 결과/낮은 점수) → 라이브러리 보강 큐로. 측정된 관찰일수록 가치 큰 miss.
        if is_miss(hits):
            log_miss(
                o["reference_query"],
                context={
                    "sub_problem": sp,
                    "persona": persona_hint,
                    "measured": o.get("measured", False),
                    "region": "hand" if sp == "hand_structure" else None,
                    "top_score": round(float(hits[0][1]), 4) if hits else None,
                },
            )
            # AI 적격 축(풍경·명암·구도·빛·색)이면 ai_example 생성 *작업* 시작 → job_id.
            #   인체/포즈/손 축은 start_backfill 이 None(생성 안 함). 인라인 모드면 그 자리에서 ready 까지.
            job_id = start_backfill(sp, track=track, medium=medium)
            if job_id:
                st = _ref_job_status(job_id)
                if st["status"] == "ready" and st["ref_id"]:
                    hits = [(st["ref_id"], 1.0)]  # 인라인: 이번 턴에 바로 노출
                elif st["status"] == "generating":
                    pending_by_sp[sp] = job_id  # 비동기: '생성 중' 으로 프런트에 신호
        refs_by_sp[sp] = [(rid, "") for rid, _ in hits]
        retrieved |= {rid for rid, _ in hits}
    return (dx, refs_by_sp, retrieved, tax, growth, intent, pending_by_sp), None


@router.post("/analyze")
async def analyze_ep(file: UploadFile, message: str = Form("")):
    file_bytes = await file.read()
    return await asyncio.to_thread(_analyze_sync, file_bytes, message)


def _analyze_sync(file_bytes, message):
    ctx, early = _pipeline(file_bytes, message)
    if early:
        return early
    dx = ctx[0]
    return {
        "primary_focus": dx["primary_focus"],
        "degraded": dx["degraded"],
        "persona": dx["persona"],
        "observations": [
            {
                "sub_problem": o["sub_problem"],
                "confidence": o["confidence"],
                "signal": o["signal"],
            }
            for o in dx["observations"]
        ],
    }


def _log_impressions(guide_id, refs_by_sp, tax):
    """노출(shown)을 sub_problem·persona·source_type와 함께 서버에서 기록(피드백 신호 원천).
    클라가 보내던 'shown'은 서버가 더 완전하게 대체. 실패해도 /guide는 정상 응답."""
    ref_ids = list({rid for refs in refs_by_sp.values() for rid, _ in refs})
    if not ref_ids:
        return
    try:
        with engine.begin() as cx:
            src = {}
            q = text(
                "SELECT ref_id, source_type FROM reference_images WHERE ref_id IN :ids"
            ).bindparams(bindparam("ids", expanding=True))
            for ref_id, st in cx.execute(q, {"ids": ref_ids}):
                src[ref_id] = st
            rows = []
            for sp, refs in refs_by_sp.items():
                persona = tax[sp]["personas"][0]
                for rid, _ in refs:
                    rows.append(
                        dict(
                            g=guide_id,
                            r=rid,
                            p=persona,
                            st=src.get(rid, "unknown"),
                            sp=sp,
                        )
                    )
            if rows:
                cx.execute(
                    text("""INSERT INTO adoption_log
                    (guide_id,reference_id,persona,source_type,sub_problem,event)
                    VALUES (:g,:r,:p,:st,:sp,'shown')"""),
                    rows,
                )
    except Exception as e:
        print(f"[guide] 노출 로깅 실패(무시): {type(e).__name__}: {e}")


def _log_observable(user_id, measurable, guide_id):
    """이번 업로드에서 *측정 가능*했던 축(주제 등장)을 'observable'로 누적 — flagged('seen')과 분리 기록.
    roadmap 이 '부재(안 그림) → steady'를 '개선(그렸는데 덜 걸림)'과 구분하게 하는 관측층 신호.
    실패해도 /guide 는 정상 응답."""
    rows = [
        dict(u=user_id or "anon", sp=sp, g=guide_id, iv=instrument_version())
        for sp in (measurable or ())
    ]
    if not rows:
        return
    try:
        with engine.begin() as cx:
            cx.execute(
                text(
                    "INSERT INTO practice_log (user_id, sub_problem, action, guide_id, instrument_version) "
                    "VALUES (:u, :sp, 'observable', :g, :iv)"
                ),
                rows,
            )
    except Exception as e:
        print(f"[guide] observable 로깅 실패(무시): {type(e).__name__}: {e}")


def _claim_request(request_id, guide_id):
    """(first, guide_id). first=True 면 이번이 첫 처리(부작용 기록). False 면 재시도(기존 guide_id 반환).
    request_id 없으면 (True, guide_id) — 멱등키 없는 직접 호출은 그대로 1회 기록."""
    if not request_id:
        return True, guide_id
    try:
        with engine.begin() as cx:
            r = cx.execute(
                text(
                    "INSERT IGNORE INTO guide_request (request_id, guide_id) VALUES (:rid, :gid)"
                ),
                {"rid": request_id, "gid": guide_id},
            )
            if r.rowcount == 1:
                return True, guide_id  # 새로 claim → 첫 처리
            row = cx.execute(
                text("SELECT guide_id FROM guide_request WHERE request_id=:rid"),
                {"rid": request_id},
            ).fetchone()
            return False, (row[0] if row and row[0] else guide_id)
    except Exception as e:
        print(f"[dedup] claim 실패(무시, 로깅 진행): {type(e).__name__}: {e}")
        return True, guide_id


def _record_side_effects(resp, refs_by_sp, tax, user_id, dx, request_id):
    """coach 부작용(노출/연습/관측 로그)을 request_id 로 at-most-once.
    재시도(같은 request_id)면 skip → practice_log/adoption_log 중복 집계 방지.
    guide_id 는 첫 처리 것으로 정렬(응답이 기록과 같은 guide_id 참조)."""
    first, gid = _claim_request(request_id, resp.guide_id)
    resp.guide_id = gid
    if not first:
        return
    _log_impressions(resp.guide_id, refs_by_sp, tax)
    for b in resp.blocks:
        record_practice(
            user_id,
            b.sub_problem,
            "seen",
            confidence=b.confidence,
            guide_id=resp.guide_id,
        )
    _log_observable(user_id, dx.get("measurable", ()), resp.guide_id)


def _make_overlay(dx, growth):
    """모드 선택(이론 vs 오버레이) 후 overlay_axes 만 그림 위에 렌더(라우트에서 생성).
    반환: payload 에 합칠 {overlay(SVG|None), visual_mode{theory_axes, overlay_axes}}."""
    mode = select_visual_mode(dx.get("observations", []), growth)
    sel = set(mode["overlay_axes"])
    obs = [o for o in dx.get("observations", []) if o.get("sub_problem") in sel]
    tier = dx.get("pose_tier", "fail")
    w, h = dx.get("image_size") or (0, 0)
    overlay = None
    if obs and w and h:
        anns = resolve_anchors(obs, dx.get("spatial") or {}, tier)
        overlay = build_overlay(w, h, anns, tier) if anns else None
    return {
        "overlay": overlay,
        "visual_mode": {
            "theory_axes": mode["theory_axes"],
            "overlay_axes": mode["overlay_axes"],
        },
    }


@router.post("/guide")
async def guide_ep(
    file: UploadFile,
    message: str = Form(""),
    user_id: str = Form("anon"),
    intent: str = Form("open"),
    track: str = Form(None),
    medium: str = Form(None),
    request_id: str = Form(None),
):
    file_bytes = await file.read()
    return await asyncio.to_thread(
        _guide_sync, file_bytes, message, user_id, intent, track, medium, request_id
    )


def _guide_sync(file_bytes, message, user_id, intent, track, medium, request_id):
    ctx, early = _pipeline(file_bytes, message, user_id, intent, track, medium)
    if early:
        return early
    dx, refs_by_sp, retrieved, tax, growth, intent, pending_by_sp = ctx
    # 에이전트 선택층(grounded): 룰이 낸 후보 중에서 무엇을 먼저·어떤 레퍼런스로 보여줄지 *선택* → 검증 → 적용.
    decision, _ = agent.decide(
        dx, refs_by_sp, growth, intent=intent, track=track, llm=llm
    )
    dx = agent.apply(dx, decision)
    refs_by_sp = agent.order_refs(refs_by_sp, decision)
    # 3D 백본(self_render) → guide_asset backbone_3d 다리. 보여줄 축 + 로드맵 집중/다음 축에 대해 후보를 모은다.
    #   적재된 self_render 가 없으면 빈 색인 → assets 가 svg 도식 바닥으로 폴백(슬롯은 안 빔).
    asset_sps = [o["sub_problem"] for o in dx.get("observations", [])]
    if growth:
        asset_sps += [growth.get("current_focus"), growth.get("next_goal")]
    asset_index = build_asset_index(asset_sps)
    resp = run_guide(
        dx,
        refs_by_sp,
        retrieved,
        tax,
        llm,
        growth=growth,
        intent=intent,
        asset_index=asset_index,
    )
    # '생성 중' 레퍼런스 신호 — 보여줄 블록(sub_problem)에 해당하는 미스 job 만 노출(없으면 빈 리스트).
    if pending_by_sp:
        shown = {b.sub_problem for b in resp.blocks}
        resp.pending_references = [
            PendingReference(sub_problem=sp, job_id=jid)
            for sp, jid in pending_by_sp.items()
            if sp in shown
        ]
    growth_obj = None
    if resp.mode == "coach":
        resp.guide_id = str(uuid.uuid4())
        _record_side_effects(resp, refs_by_sp, tax, user_id, dx, request_id)
        # §4 성장 흐름 — 방금 기록한 'seen'(이번 업로드 포함)까지 반영해 집계
        _note = resp.next_steps.note if resp.next_steps else None
        growth_obj = growth_from_raw(
            growth_view(user_id, track=track, degraded=resp.degraded), note=_note
        )
    payload = finalize_guide_response(resp, growth_obj=growth_obj)
    payload.update(_make_overlay(dx, growth))  # 모드 선택 → overlay_axes 만 렌더
    return payload


@router.post("/guide/stream")
async def guide_stream_ep(
    file: UploadFile,
    message: str = Form(""),
    user_id: str = Form("anon"),
    intent: str = Form("open"),
    track: str = Form(None),
    medium: str = Form(None),
    request_id: str = Form(None),
):
    file_bytes = await file.read()
    return await asyncio.to_thread(
        _guide_stream_sync,
        file_bytes,
        message,
        user_id,
        intent,
        track,
        medium,
        request_id,
    )


def _guide_stream_sync(file_bytes, message, user_id, intent, track, medium, request_id):
    ctx, early = _pipeline(file_bytes, message, user_id, intent, track, medium)
    if early:
        body = [
            f"data: {json.dumps(early, ensure_ascii=False)}\n\n",
            "data: [DONE]\n\n",
        ]
        return StreamingResponse(iter(body), media_type="text/event-stream")
    dx, refs_by_sp, retrieved, tax, growth, intent, _pending = ctx
    decision, _ = agent.decide(
        dx, refs_by_sp, growth, intent=intent, track=track, llm=llm
    )
    dx = agent.apply(dx, decision)
    refs_by_sp = agent.order_refs(refs_by_sp, decision)
    # 가드레일 통과 응답을 *먼저* 만들고(닫힌세계·금지표현·근거 검증), 그 검증된 블록만 스트리밍한다.
    #   이전엔 raw LLM 토큰을 그대로 흘려 /guide/stream 만 가드레일을 우회했다(평가어·환각 ref 누출 위험).
    #   이제 두 경로(/guide·/guide/stream)가 같은 검증을 거친다 — 핵심 안전 불변식 유지.
    asset_sps = [o["sub_problem"] for o in dx.get("observations", [])]
    if growth:
        asset_sps += [growth.get("current_focus"), growth.get("next_goal")]
    asset_index = build_asset_index(asset_sps)
    resp = run_guide(
        dx,
        refs_by_sp,
        retrieved,
        tax,
        llm,
        growth=growth,
        intent=intent,
        asset_index=asset_index,
    )
    growth_obj = None
    if resp.mode == "coach":
        resp.guide_id = str(uuid.uuid4())
        _record_side_effects(resp, refs_by_sp, tax, user_id, dx, request_id)
        # §4 성장 흐름 — 방금 기록한 'seen'(이번 업로드 포함)까지 반영해 집계
        _note = resp.next_steps.note if resp.next_steps else None
        growth_obj = growth_from_raw(
            growth_view(user_id, track=track, degraded=resp.degraded), note=_note
        )

    def gen():
        payload = finalize_guide_response(resp, growth_obj=growth_obj)
        payload.update(_make_overlay(dx, growth))  # 모드 선택 → 스트림 payload
        # 점진 렌더용: 블록을 하나씩 흘린 뒤, 마지막에 전체 응답(메타·next_steps 포함)을 보낸다.
        for b in payload.get("blocks", []):
            yield f"data: {json.dumps({'type': 'block', 'block': b}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'guide': payload}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/ref-job/{job_id}")
def ref_job(job_id: str):
    """'생성 중' 레퍼런스 폴링. 반환: {status, ref_id, image_path}.
    - generating : 아직 만드는 중(프런트는 계속 폴링).
    - ready      : ref_id 사용 가능 → image_path('/guide/image/<ref_id>')로 표시.
    - failed/unknown : 생성 실패 또는 만료 → 프런트는 폴링 중단, 도식 폴백 유지.
    """
    st = _ref_job_status(job_id)
    out = {"status": st["status"], "ref_id": st.get("ref_id"), "image_path": None}
    if st["status"] == "ready" and st.get("ref_id"):
        out["image_path"] = f"/guide/image/{st['ref_id']}"
    return out


@router.get("/image/{ref_id}")
def image(ref_id: str):
    """ref_id → 실제 이미지로 302 리다이렉트(임시 presigned URL).
    운영자가 /search 결과의 url을 그대로 테스트 페이지에 붙여넣을 수 있게 해주는 연결고리."""
    if not valid_ref_id(ref_id):
        raise HTTPException(status_code=404, detail="invalid ref_id")
    with engine.begin() as cx:
        row = cx.execute(
            text("SELECT image_key FROM reference_images WHERE ref_id=:r"),
            {"r": ref_id},
        ).fetchone()
    key = row[0] if row else f"images/{ref_id}.png"
    return RedirectResponse(presigned_url(key))


@router.post("/search")
def search_ep(
    request: Request,
    query: str = Form(...),
    persona: str = Form(None),
    gender: str = Form(None),
    body_type: str = Form(None),
    region: str = Form(None),
    category: str = Form(None),
):
    base = str(request.base_url).rstrip("/")
    filters = {
        "gender": gender,
        "body_type": body_type,
        "region": region,
        "category": category,
    }
    hits = search_text(query, persona, filters=filters)
    # 붙여넣기 가능한 절대 URL 동봉 → 운영자가 /docs에서 바로 복사.
    return {
        "hits": [
            {"ref_id": rid, "score": round(float(s), 4), "url": f"{base}/image/{rid}"}
            for rid, s in hits
        ]
    }


class AdoptEvent(BaseModel):
    guide_id: str
    reference_id: str
    # persona/source_type 는 노출(_log_impressions) 시점엔 채워지지만, 외부 호출자(Spring 등)가
    # liked/disliked 만 보낼 때는 모를 수 있다 → 옵셔널. 비면 adopt() 가 서버에서 보강한다.
    persona: str | None = None
    source_type: str | None = None
    event: str


_adopt_schema_ready = False


def _ensure_adopt_schema():
    """adoption_log.event ENUM에 'disliked' 슬롯을 1회 확장(마이그레이션 없이 dev 편의)."""
    global _adopt_schema_ready
    if _adopt_schema_ready:
        return
    try:
        with engine.begin() as cx:
            cx.execute(
                text(
                    "ALTER TABLE adoption_log MODIFY event "
                    "ENUM('shown','clicked','saved','liked','disliked') NOT NULL"
                )
            )
        _adopt_schema_ready = True
    except Exception as e:
        print(f"[adopt] event ENUM 확장 실패(무시): {type(e).__name__}: {e}")


@router.post("/adopt")
def adopt(e: AdoptEvent):
    _ensure_adopt_schema()
    if clean_event(e.event) is None:  # 화이트리스트 밖 이벤트 차단(랭커 오염 방지)
        raise HTTPException(status_code=400, detail="invalid event")
    with engine.begin() as cx:
        persona, source_type = e.persona, e.source_type
        # 호출자가 안 준 경우 서버가 보강: source_type=reference_images, persona=직전 'shown' 행.
        # (liked/disliked 행도 persona 를 갖게 되어 persona별 선호 분석이 가능)
        if source_type is None:
            r = cx.execute(
                text("SELECT source_type FROM reference_images WHERE ref_id=:r"),
                {"r": e.reference_id},
            ).fetchone()
            source_type = r[0] if r else "unknown"
        if persona is None:
            r = cx.execute(
                text(
                    "SELECT persona FROM adoption_log "
                    "WHERE guide_id=:g AND reference_id=:r AND event='shown' "
                    "ORDER BY id DESC LIMIT 1"
                ),
                {"g": e.guide_id, "r": e.reference_id},
            ).fetchone()
            persona = r[0] if r else None
        cx.execute(
            text("""INSERT INTO adoption_log
          (guide_id,reference_id,persona,source_type,event)
          VALUES (:guide_id,:reference_id,:persona,:source_type,:event)"""),
            {
                "guide_id": e.guide_id,
                "reference_id": e.reference_id,
                "persona": persona,
                "source_type": source_type,
                "event": e.event,
            },
        )
    return {"ok": True}


# ── 진척(성장) 레이어 라우트 — /roadmap · /practice ──────────────────────────
class PracticeEvent(BaseModel):
    user_id: str = "anon"
    sub_problem: str
    action: str  # 'tried' | 'later' (UI의 시도해봤어요/나중에)
    confidence: float | None = None
    guide_id: str | None = None


@router.get("/roadmap")
def roadmap_ep(user_id: str = "anon", track: str = None):
    """현재 단계 → 다음 연습 → 다음 목표 + 자주 막히는 부분(recurring). track 커리큘럼 기준."""
    return get_roadmap(user_id, track=track)


@router.post("/practice")
def practice_ep(e: PracticeEvent):
    if (
        clean_event(e.action, PRACTICE_ACTIONS) is None
    ):  # 'tried'|'later'|'seen' 만 허용
        raise HTTPException(status_code=400, detail="invalid action")
    record_practice(
        e.user_id, e.sub_problem, e.action, clamp_confidence(e.confidence), e.guide_id
    )
    return {"ok": True}


@router.get("/svg/{ref_id}")
def svg(ref_id: str):
    """구축선 SVG 서빙 (/image 의 SVG 버전). svg_key 없으면 조용히 빈 응답."""
    if not valid_ref_id(ref_id):
        raise HTTPException(status_code=404, detail="invalid ref_id")
    try:
        with engine.begin() as cx:
            row = cx.execute(
                text("SELECT svg_key FROM reference_images WHERE ref_id=:r"),
                {"r": ref_id},
            ).fetchone()
        if not row or not row[0]:
            return {"error": "no svg for this ref"}
        return RedirectResponse(presigned_url(row[0]))
    except Exception as e:
        print(f"[svg] 조회 실패(무시): {type(e).__name__}: {e}")
        return {"error": "svg lookup failed"}


@router.get("/guide-asset/{ref_id:path}")
def guide_asset(ref_id: str):
    """설명 자료 슬롯 서빙. 'floor:<축>'이면 도식 SVG를 인라인으로(적재 0개여도 항상 나옴),
    'reference/<name>.svg'면 파일 기반 구축 도식을 인라인으로(경로탈출 차단),
    그 외(적재된 ai_example·backbone_3d)는 reference_images.image_key 로 presigned 리다이렉트."""
    from guide.pipeline.assets import floor_svg
    from guide.pipeline.asset_index import read_reference_svg
    from fastapi.responses import Response

    if ref_id.startswith("floor:"):
        sp = ref_id.split(":", 1)[1]
        return Response(content=floor_svg(sp), media_type="image/svg+xml")
    if ref_id.startswith("reference/"):
        svg = read_reference_svg(ref_id)
        if svg:
            return Response(content=svg, media_type="image/svg+xml")
        # 파일 못 찾아도 깨진 이미지 대신 빈 SVG(슬롯 신뢰 유지). 로그만 남김.
        print(f"[guide-asset] reference 파일 없음(빈 SVG 폴백): {ref_id}")
        return Response(
            content='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180"/>',
            media_type="image/svg+xml",
        )
    if not valid_ref_id(ref_id):
        raise HTTPException(status_code=404, detail="invalid ref_id")
    try:
        with engine.begin() as cx:
            row = cx.execute(
                text("SELECT image_key FROM reference_images WHERE ref_id=:r"),
                {"r": ref_id},
            ).fetchone()
        if not row or not row[0]:
            return {"error": "no asset for this ref"}
        return RedirectResponse(presigned_url(row[0]))
    except Exception as e:
        print(f"[guide-asset] 조회 실패(무시): {type(e).__name__}: {e}")
        return {"error": "asset lookup failed"}
