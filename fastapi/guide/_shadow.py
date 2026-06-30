"""②v1 섀도우 계측 — 요청당 '결정 분포 + 레이턴시'를 JSONL 한 줄로(관측 전용, 동작 불변).

목적: day-1 발화율 분포·weight_balance over-fire 빈도(영역4 CLOSED 이관)·p95 레이턴시를
*이미지/식별자 0*으로 쌓아 "발화율이 애초에 유의미한가"를 먼저 답한다. 분포지 정확도가 아니다
(이미지 미저장 → 사후 정/오발화 판정 불가 = v2 동의 기반 스팟체크 몫).

설계 불변식(절대):
  • read-only: 이미 확정된 dx 출력 + resp.mode + 외부 측정 dt 만 읽는다. 결정 로직(diagnose 게이트/
    surface, agent)에 0 접촉 → 발화 0 수정·스코어보드 byte-identical.
  • emit 실패가 요청을 못 죽인다: 전체 try/except 로 삼키고 stderr 한 줄만(/guide 응답은 정상).
  • 별도 싱크: TRACE_CTX(사람용 stdout 디버그)와 독립. SHADOW_AUDIT 로 따로 켠다(프로덕션 상시 ON 가능).
    싱크/append 규약은 ai_qc_audit.jsonl(pipeline/ai_ingest.py) 선례를 따른다(로테이션 없음, 경로 env).

레코드: 이미지·이미지ID·user_id·request_id·원본 픽셀·프롬프트 텍스트 0(분포만, 프라이버시).
"""
import os
import json
import datetime


def _on() -> bool:
    return os.environ.get("SHADOW_AUDIT", "0").strip().lower() not in ("", "0", "false", "no")


def emit(dx, resp, dt, track=None) -> None:
    """요청당 1줄. dx(확정된 diagnose 출력)·resp(실현 mode)·dt(end-to-end 초)만 read-only.
    SHADOW_AUDIT 꺼져 있으면 즉시 반환(기본 경로 영향 0)."""
    if not _on():
        return
    try:
        obs = dx.get("observations", []) or []
        wb = next((o for o in obs if o.get("sub_problem") == "weight_balance"), None)
        primary = dx.get("primary_focus")
        mode = getattr(resp, "mode", None)
        rec = {
            "ts": datetime.datetime.utcnow().isoformat() + "Z",
            "track": track,
            "pose_tier": dx.get("pose_tier"),
            "degraded": dx.get("degraded"),
            "measurable": dx.get("measurable"),
            "primary_focus": primary,                       # None = abstain
            "mode": mode,                                   # coach | clarify (실현된 응답)
            "abstain": primary is None or mode == "clarify",
            "fired": [
                {
                    "axis": o.get("sub_problem"),
                    "conf": o.get("confidence"),
                    "measured": o.get("measured"),
                }
                for o in obs
            ],
            # 영역4 over-fire 추적(CLOSED 이관): weight_balance 발화 여부 + conf + measured.
            "weight_balance": (
                {"fired": True, "conf": wb.get("confidence"), "measured": wb.get("measured")}
                if wb
                else {"fired": False}
            ),
            "latency_ms": round(dt * 1000) if dt is not None else None,
        }
        path = os.environ.get("SHADOW_AUDIT_LOG", "/tmp/guide_shadow.jsonl")
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:  # 관측기가 요청을 죽이면 안 된다(불변식)
        print(f"[shadow] emit 실패(무시): {type(e).__name__}: {e}", flush=True)
