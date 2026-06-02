"""
SNS → Discord webhook 알림 Lambda.
- 의존성 없음: urllib + (런타임 기본 제공) boto3 만 사용 → zip 패키징 불필요.
- 웹훅 URL 은 SSM SecureString 에서 런타임에 읽음 → Terraform state 에 노출 안 됨.
- CloudWatch 알람 메시지(JSON)면 임베드로, 아니면 raw 텍스트로 전송.
"""
import json
import os
import urllib.request

import boto3

_ssm = boto3.client("ssm")
_webhook = None

# Discord embed 색상 (ALARM=빨강, OK=초록, 그 외=노랑/회색)
_COLOR = {"ALARM": 0xE01E5A, "OK": 0x2EB67D, "INSUFFICIENT_DATA": 0xECB22E}


def _get_webhook():
    global _webhook
    if _webhook is None:
        name = os.environ["WEBHOOK_PARAM"]
        _webhook = _ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    return _webhook


def _build_embed(subject, message):
    env = os.environ.get("ENVIRONMENT", "")
    try:
        a = json.loads(message)
        state = a.get("NewStateValue", "")
        name = a.get("AlarmName", subject)
        desc = a.get("AlarmDescription") or ""
        reason = a.get("NewStateReason", "")
        region = a.get("Region", "")
        body = (desc + "\n\n" if desc else "") + reason
        return {
            "title": f"[{env}] {name}"[:256],
            "description": body[:4000],
            "color": _COLOR.get(state, 0x808080),
            "fields": [
                {"name": "State", "value": state or "-", "inline": True},
                {"name": "Region", "value": region or "-", "inline": True},
            ],
        }
    except (ValueError, TypeError):
        # CloudWatch 알람이 아닌 일반 SNS 메시지
        return {"title": (subject or "AWS Alert")[:256],
                "description": str(message)[:4000],
                "color": 0x808080}


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
