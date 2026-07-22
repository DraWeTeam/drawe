"""
SNS → Discord webhook 알림 Lambda.
- 의존성 없음: urllib + (런타임 기본 제공) boto3 만 사용 → zip 패키징 불필요.
- 웹훅 URL 은 SSM SecureString 에서 런타임에 읽음 → Terraform state 에 노출 안 됨.
- 메시지 종류별 렌더링:
    1) CloudWatch 알람(JSON, AlarmName/NewStateValue)  → 상태색 임베드(기존 동작 유지)
    2) AMP 알림(우리 텍스트 포맷, 'STATUS=' 로 시작)     → 심각도/상태색 + 필드 임베드
    3) 그 외                                            → 회색 폴백
"""
import json
import os
import urllib.request

import boto3

_ssm = boto3.client("ssm")
_webhook = None

# CloudWatch 알람 상태색 (기존)
_CW_COLOR = {"ALARM": 0xE01E5A, "OK": 0x2EB67D, "INSUFFICIENT_DATA": 0xECB22E}

# AMP 알림 색/이모지
_GRAY = 0x808080
_RESOLVED_COLOR = 0x2EB67D            # 초록
_SEV_COLOR = {                        # 심각도별
    "critical": 0xE01E5A,             # 빨강
    "warning": 0xECB22E,              # 노랑
    "info": 0x5865F2,                 # 파랑
}
_SEV_EMOJI = {"critical": "🔴", "warning": "🟡", "info": "🔵"}


def _get_webhook():
    global _webhook
    if _webhook is None:
        name = os.environ["WEBHOOK_PARAM"]
        _webhook = _ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    return _webhook


def _cw_embed(a, subject):
    """CloudWatch 알람 JSON → 임베드 (기존 동작)."""
    env = os.environ.get("ENVIRONMENT", "")
    state = a.get("NewStateValue", "")
    name = a.get("AlarmName", subject)
    desc = a.get("AlarmDescription") or ""
    reason = a.get("NewStateReason", "")
    region = a.get("Region", "")
    body = (desc + "\n\n" if desc else "") + reason
    return {
        "title": f"[{env}] {name}"[:256],
        "description": body[:4000],
        "color": _CW_COLOR.get(state, _GRAY),
        "fields": [
            {"name": "State", "value": state or "-", "inline": True},
            {"name": "Region", "value": region or "-", "inline": True},
        ],
    }


def _parse_amp(message):
    """AMP 알림 텍스트 파싱. 형식(amp-alertmanager.tf message 블록과의 계약):
        STATUS=<firing|resolved>
        SEVERITY=<critical|warning|info>
        ALERTNAME=<name>
        SERVICE=<name>
        ---
        <summary/description 자유 텍스트 (여러 줄 가능)>
    헤더 4줄은 통제된 라벨 값이라 이스케이프 문제 없음. 본문은 그대로 사용.
    """
    if not message.startswith("STATUS="):
        return None
    head, sep, body = message.partition("\n---\n")
    if not sep:  # 구분자 없으면 형식 불일치 → 폴백에 맡김
        return None
    fields = {}
    for line in head.splitlines():
        k, _, v = line.partition("=")
        fields[k.strip()] = v.strip()
    fields["_body"] = body.strip()
    return fields


def _amp_embed(f):
    env = os.environ.get("ENVIRONMENT", "")
    status = (f.get("STATUS") or "").lower()
    sev = (f.get("SEVERITY") or "").lower()
    name = f.get("ALERTNAME") or "alert"
    service = f.get("SERVICE") or "-"
    resolved = status == "resolved"
    color = _RESOLVED_COLOR if resolved else _SEV_COLOR.get(sev, _GRAY)
    emoji = "✅" if resolved else _SEV_EMOJI.get(sev, "⚪")
    state_label = "해제됨" if resolved else "발생"
    body = f.get("_body") or ""
    return {
        "title": f"[{env}] {emoji} {name}"[:256],
        "description": body[:4000] if body else "(내용 없음)",
        "color": color,
        "fields": [
            {"name": "상태", "value": state_label, "inline": True},
            {"name": "심각도", "value": sev or "-", "inline": True},
            {"name": "서비스", "value": service, "inline": True},
        ],
    }


def _build_embed(subject, message):
    # 1) CloudWatch 알람 (JSON)
    try:
        a = json.loads(message)
        if isinstance(a, dict) and ("AlarmName" in a or "NewStateValue" in a):
            return _cw_embed(a, subject)
    except (ValueError, TypeError):
        pass
    # 2) AMP 알림 (우리 텍스트 포맷)
    parsed = _parse_amp(message)
    if parsed:
        return _amp_embed(parsed)
    # 3) 그 외 — 회색 폴백
    return {
        "title": (subject or "AWS Alert")[:256],
        "description": str(message)[:4000],
        "color": _GRAY,
    }


def handler(event, context):
    webhook = _get_webhook()
    for rec in event.get("Records", []):
        sns = rec["Sns"]
        embed = _build_embed(sns.get("Subject"), sns["Message"])
        payload = json.dumps({"embeds": [embed]}).encode("utf-8")
        req = urllib.request.Request(
            webhook,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "DraweAlertBot/1.0 (AWS Lambda; +https://drawe.xyz)",
            },
        )
        urllib.request.urlopen(req, timeout=8)  # Discord 는 성공 시 204
    return {"ok": True}
