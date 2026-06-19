"""pipeline/ai_fallback.py — '미스 축'에 ai_example 을 생성·QC·적재해 코퍼스를 자가치유.

언제: search 가 miss(빈 결과/낮은 점수)인데 그 축이 *AI 적격*(value/구도/빛/색/대기원근/깊이 —
신뢰도가 핵심인 인체·포즈·손·비율은 제외)일 때. 이 적격 집합은 ai_qc.AI_ELIGIBLE_AXES 단일출처를 따른다
(정책이 assets.AXIS_PREF/AI_AVOID 한 곳에서 정의됨 — 여기서 재정의하지 않는다).

흐름:  concept(taxonomy.reference_query + medium/track 수식)
         → ml.generate.generate(provider 중립)  → PIL|None
         → ai_ingest.qc_and_ingest(QC 통과 시에만 Qdrant+MySQL 적재, source_type='ai_example')

기본은 *백그라운드*(fire-and-forget): 이번 요청은 기다리지 않고 빠르게 응답하고, 생성물은 다음
같은 축·트랙 요청에서 검색돼 노출된다(코퍼스가 점점 채워짐). AI_FALLBACK_INLINE=1 이면 이번 턴에
동기 생성해 ref_id 를 돌려준다(레이턴시↑, UX 트레이드오프).

비용 가드: (축,트랙,medium) 키로 쿨다운(중복 생성 차단) + 프로세스당 총량 캡. 전부 best-effort —
생성/적재 실패가 /guide 를 막지 않는다.
"""

import os
import time
import uuid
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from guide.pipeline.ai_qc import AI_ELIGIBLE_AXES
from guide.pipeline.diagnose import taxonomy

log = logging.getLogger("drawe-fastapi.guide")

# 적격 축에만 생성을 시도(인체/포즈/손/비율은 여기 없음 — ai_qc 가 한 번 더 hard-reject 한다).
def eligible(axis) -> bool:
    return axis in AI_ELIGIBLE_AXES


# ── concept 빌더 ────────────────────────────────────────────────────────────────
# taxonomy.reference_query 는 이미 영어·CLIP 친화 문구이고, ai_qc 의 축 probe 와 *같은* 텍스트라
# 이걸 concept 베이스로 쓰면 QC 통과 확률이 가장 높다(생성↔검증 정렬). medium/track 으로 화풍·주제만 더한다.
_MEDIUM_STYLE = {
    "digital": "digital illustration",
    "pencil": "pencil drawing study",
    "watercolor": "watercolor painting",
    "sketch": "rough sketch study",
    "painting": "painted study",
}
_TRACK_HINT = {"landscape": "landscape scene"}


def build_concept(axis, *, track=None, medium=None) -> str:
    base = (taxonomy().get(axis, {}) or {}).get("reference_query") or axis
    bits = [base]
    if track in _TRACK_HINT:
        bits.append(_TRACK_HINT[track])
    bits.append(_MEDIUM_STYLE.get(medium, "instructional art reference, clean illustration"))
    # 예시 자료는 사진이 아니라 '그림'이어야 QC(is_illustration)를 통과한다 → 항상 일러스트로 강제.
    return ", ".join(bits)


# ── 쿨다운 + 캡(프로세스 로컬, best-effort) ──────────────────────────────────────
_COOLDOWN_S = float(os.environ.get("AI_FALLBACK_COOLDOWN_S", "3600"))  # 같은 키 재생성 금지 창
_MAX_PER_PROCESS = int(os.environ.get("AI_FALLBACK_MAX", "200"))  # 폭주 방지 총량 캡
_INLINE = os.environ.get("AI_FALLBACK_INLINE", "0").lower() in ("1", "true", "yes")
_ENABLED = os.environ.get("AI_FALLBACK", "1").lower() in ("1", "true", "yes")

_JOB_TTL_S = float(os.environ.get("AI_FALLBACK_JOB_TTL_S", "900"))  # 완료 job 보관(폴링 창)

_lock = threading.Lock()
_recent = {}  # key -> last_ts (쿨다운)
_count = {"n": 0}  # 프로세스당 총 생성 캡
_jobs = {}  # job_id -> {status, ref_id, axis, ts}  (status: generating|ready|failed)
_key2job = {}  # (축|트랙|medium) -> 진행중 job_id (동시 같은 미스는 한 job 을 공유 → 중복 생성 0)
_pool = ThreadPoolExecutor(max_workers=int(os.environ.get("AI_FALLBACK_WORKERS", "2")))


def _key(axis, track, medium):
    return f"{axis}|{track or ''}|{medium or ''}"


def _prune(now):
    """오래된 완료 job 정리(메모리 누수 방지). 호출자가 _lock 보유."""
    dead = [jid for jid, j in _jobs.items() if now - j["ts"] > _JOB_TTL_S]
    for jid in dead:
        _jobs.pop(jid, None)


def _set(job_id, **patch):
    with _lock:
        j = _jobs.get(job_id)
        if j:
            j.update(patch)
            j["ts"] = time.time()
            if patch.get("status") in ("ready", "failed"):
                _key2job.pop(j.get("_key"), None)  # 끝난 job 은 공유 슬롯에서 해제


def _run_job(job_id, axis, track, medium, concept):
    """실제 생성→QC→적재. 끝나면 job 상태를 ready/failed 로. 반환은 안 봄(상태로 통신)."""
    from guide.ml.generate import generate
    from guide.pipeline.ai_ingest import qc_and_ingest

    pil = generate(concept)
    if pil is None:
        log.info("[ai_fallback] 생성 결과 없음: axis=%s", axis)
        return _set(job_id, status="failed")
    try:
        res = qc_and_ingest(
            pil, concept,
            intended_axes=[axis],  # QC 가 이 축으로 교차검증 + AI_AVOID 면 즉시 reject
            medium=medium, track=track,
        )
    except Exception as e:
        log.warning("[ai_fallback] qc_and_ingest 실패: %s: %s", type(e).__name__, e)
        return _set(job_id, status="failed")
    if res.get("accepted"):
        log.info("[ai_fallback] 적재 OK axis=%s ref=%s", axis, res.get("ref_id"))
        return _set(job_id, status="ready", ref_id=res.get("ref_id"))
    log.info("[ai_fallback] QC 탈락 axis=%s", axis)
    _set(job_id, status="failed")


def start_backfill(axis, *, track=None, medium=None, inline=None):
    """미스 축에 ai_example 생성을 *작업(job)* 으로 시작. routes 의 is_miss 분기에서 호출.

    반환: job_id(str) | None.
      - 적격 축이 아니거나(인체/포즈 등) 비활성/쿨다운/캡이면 None → 프런트는 평소대로 도식만.
      - 같은 (축,트랙,medium) 미스가 이미 진행중이면 그 job_id 를 공유(중복 생성 0).
      - 기본 백그라운드: job 은 'generating' 으로 시작 → 프런트가 job_id 로 폴링해 'ready' 되면 교체.
      - inline=True(or AI_FALLBACK_INLINE=1): 동기로 끝까지 돌려 'ready'/'failed' 확정 후 job_id 반환
        (이번 턴에 바로 ref 노출 가능, 레이턴시↑).
    """
    if not _ENABLED or not eligible(axis):
        return None
    key = _key(axis, track, medium)
    now = time.time()
    with _lock:
        _prune(now)
        existing = _key2job.get(key)
        if existing and _jobs.get(existing, {}).get("status") == "generating":
            return existing  # 진행중인 동일 미스에 합류
        if _count["n"] >= _MAX_PER_PROCESS:
            return None
        if now - _recent.get(key, 0) < _COOLDOWN_S:
            return None  # 최근에 시도함(쿨다운) — 재생성 회피
        job_id = uuid.uuid4().hex
        _jobs[job_id] = {"status": "generating", "ref_id": None, "axis": axis,
                         "ts": now, "_key": key}
        _key2job[key] = job_id
        _recent[key] = now
        _count["n"] += 1
    concept = build_concept(axis, track=track, medium=medium)
    use_inline = _INLINE if inline is None else inline
    if use_inline:
        _run_job(job_id, axis, track, medium, concept)  # 동기
    else:
        _pool.submit(_run_job, job_id, axis, track, medium, concept)  # 백그라운드
    return job_id


def job_status(job_id):
    """폴링용. 반환: {status, ref_id}. 모르는/만료 job 은 status='unknown'."""
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            return {"status": "unknown", "ref_id": None}
        return {"status": j["status"], "ref_id": j.get("ref_id")}


# 하위호환: 기존 호출부가 있으면 inline ref_id 만 필요로 함(작업추적 불필요).
def maybe_backfill(axis, *, track=None, medium=None, inline=None):
    job_id = start_backfill(axis, track=track, medium=medium, inline=inline)
    if job_id and (_INLINE if inline is None else inline):
        return job_status(job_id).get("ref_id")
    return None
