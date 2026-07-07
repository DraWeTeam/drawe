"""ml/generate.py — 텍스트→이미지 생성기(provider 중립). ai_example 백필의 '생성' 다리.

ai_qc / ai_ingest 는 generator-agnostic(이미지가 어디서 왔든 검사·적재만 한다)이라,
그 앞단 — concept(영문 프롬프트) → PIL 한 장 — 만 이 모듈이 책임진다.

provider(AI_GEN_PROVIDER env 로 선택):
  - bedrock : AWS Bedrock Stability(us-west-2, stable-image-core). 운영(prod) 생성기. 자격=IAM(IRSA/프로필), 키 미노출.
  - gemini  : GEMINI_API_KEY + 이미지 모델(예: gemini-2.5-flash-image). dev 유지·롤백용. vision.py 와 같은 호출 형태.
  - bria    : BRIA_API_KEY/BRIA_MODEL. 보조 폴백.
  - (미선택/키없음): None 반환 → 호출자(ai_fallback)가 SVG 도식 바닥으로 폴백 → 앱은 안 깨진다.

환경 분기(코드 아님, 배포 env 로): prod=bedrock / dev=gemini. provider 셋 다 코드에 상주(교체 아닌 추가).

원칙:
  - 정책 판단(어느 축을 생성해도 되는지)은 여기 없음 — ai_fallback/ai_qc 가 소유. 여기선 순수 생성.
  - 모든 네트워크/디코드 예외를 삼켜 None 반환(생성 실패가 /guide 를 절대 막지 않음).
  - provider 별 엔드포인트/응답 스키마는 *각 provider 문서 기준* — 바뀌면 _bria/_gemini/_bedrock 만 손본다.
"""

import io
import os
import base64
import logging

import requests

from guide.config import settings

log = logging.getLogger("drawe-fastapi.guide")

_TIMEOUT = float(
    os.environ.get("AI_GEN_TIMEOUT", "20")
)  # 초. 인라인 모드에선 더 짧게 권장.
# 생성물은 자료용 일러스트 — 정사각 한 장이면 충분(임베딩·썸네일 친화).
_SIZE = int(os.environ.get("AI_GEN_SIZE", "768"))


def _provider():
    """활성 provider 이름. AI_GEN_PROVIDER 우선, 없으면 gemini→bria 순, 둘 다 없으면 ''(=생성 비활성).

    이 기능의 기본 생성기는 Gemini(이미지). 운영에서 GEMINI_API_KEY 가 guide 태스크에 이미 주입돼
    있고(손 VLM 과 공유), AI_GEN_PROVIDER=gemini 로 고정한다. bria 는 키만 있으면 폴백으로 쓸 수 있다.
    """
    p = (os.environ.get("AI_GEN_PROVIDER") or "").strip().lower()
    if p:
        return p
    if settings.gemini_api_key:
        return "gemini"
    if settings.bria_api_key:
        return "bria"
    return ""


def _to_pil(data: bytes):
    """바이트 → RGB PIL. 디코드 실패면 None."""
    try:
        from PIL import Image

        im = Image.open(io.BytesIO(data))
        return im.convert("RGB")
    except Exception as e:
        log.warning("[generate] 이미지 디코드 실패: %s: %s", type(e).__name__, e)
        return None


# ── provider: Bria (text-to-image) ─────────────────────────────────────────────
def _bria(prompt: str):
    """Bria base text-to-image. 엔드포인트/응답 키는 Bria 문서 기준 — 버전 바뀌면 여기만 수정.

    응답이 image url 이면 한 번 더 받아 바이트로, base64 면 바로 디코드한다(둘 다 방어적으로 처리).
    """
    model = settings.bria_model or "2.3"
    url = f"https://engine.prod.bria-api.com/v1/text-to-image/base/{model}"
    headers = {"Content-Type": "application/json", "api_token": settings.bria_api_key}
    body = {
        "prompt": prompt,
        "num_results": 1,
        "aspect_ratio": "1:1",
        "sync": True,  # 결과를 바로 받기(비동기 폴링 회피)
    }
    r = requests.post(url, json=body, headers=headers, timeout=_TIMEOUT)
    r.raise_for_status()
    j = r.json() or {}
    # 응답 형태 방어: {result:[{urls:[...]}|{url:...}|{b64:...}]} 등 변형 흡수.
    result = j.get("result") or j.get("data") or []
    if not result:
        return None
    first = result[0] if isinstance(result, list) else result
    if isinstance(first, dict):
        b64 = first.get("b64") or first.get("image_base64")
        if b64:
            return _to_pil(base64.b64decode(b64))
        urls = first.get("urls") or ([first["url"]] if first.get("url") else [])
        if urls:
            img = requests.get(urls[0], timeout=_TIMEOUT)
            img.raise_for_status()
            return _to_pil(img.content)
    if isinstance(first, str):  # url 문자열만 오는 변형
        img = requests.get(first, timeout=_TIMEOUT)
        img.raise_for_status()
        return _to_pil(img.content)
    return None


# ── provider: Gemini (이미지 생성 모델) ────────────────────────────────────────
def _gemini(prompt: str):
    """Gemini 이미지 모델. vision.py 의 generateContent 패턴과 동일(inline_data=base64 응답)."""
    model = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={settings.gemini_api_key}"
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        # 이미지 출력 모델(gemini-2.5-flash-image 등)은 IMAGE 모달리티를 요청해야 inline_data 를 돌려준다.
        # (필드명/허용값은 Gemini 문서 기준 — 모델 버전 바뀌면 여기만 조정.)
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
    }
    r = requests.post(url, json=body, timeout=_TIMEOUT)
    r.raise_for_status()
    j = r.json() or {}
    for cand in j.get("candidates", []):
        for part in (cand.get("content", {}) or {}).get("parts", []):
            inline = part.get("inline_data") or part.get("inlineData")
            if inline and inline.get("data"):
                return _to_pil(base64.b64decode(inline["data"]))
    return None


# ── provider: AWS Bedrock (Stability text-to-image) ────────────────────────────
_bedrock_client = None


def _get_bedrock_client():
    """지연 생성 bedrock-runtime 클라이언트(1회). 자격 분리:
    - BEDROCK_AWS_PROFILE 있으면 그 프로필 사용 → dev(개인계정)에서 prod(조직) Bedrock 호출용.
    - 없으면 boto3 기본 자격 체인 → prod EKS 는 fastapi-guide IRSA(같은 계정) 그대로.
    리전은 이미지 생성 모델이 있는 us-west-2 기본(서울엔 이미지 생성 모델 없음). 자격은
    환경(프로필/IRSA)에서만 오고 코드·git 엔 키를 두지 않는다.
    """
    global _bedrock_client
    if _bedrock_client is None:
        import boto3
        from botocore.config import Config

        region = os.environ.get("BEDROCK_IMAGE_REGION", "us-west-2")
        profile = os.environ.get("BEDROCK_AWS_PROFILE") or None
        cfg = Config(
            region_name=region,
            read_timeout=int(os.environ.get("BEDROCK_TIMEOUT", "60")),
            retries={"max_attempts": 2},
        )
        session = boto3.Session(profile_name=profile)
        _bedrock_client = session.client("bedrock-runtime", config=cfg)
    return _bedrock_client


def _bedrock(prompt: str):
    """AWS Bedrock Stability text-to-image. 응답 {"images":[base64], "finish_reasons":[...]} → PIL.
    모델 기본 stability.stable-image-core-v1:1(BEDROCK_IMAGE_MODEL 로 override). finish_reasons 에
    None 이 아닌 값(필터 등)이면 이미지가 비어 None 반환 → 호출자 SVG 폴백."""
    import json

    model = os.environ.get("BEDROCK_IMAGE_MODEL", "stability.stable-image-core-v1:1")
    body = {"prompt": prompt, "aspect_ratio": "1:1", "output_format": "png"}
    resp = _get_bedrock_client().invoke_model(
        modelId=model,
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json",
    )
    payload = json.loads(resp["body"].read())
    imgs = payload.get("images") or []
    if not imgs:
        log.info(
            "[generate] bedrock 응답에 이미지 없음: finish=%s",
            payload.get("finish_reasons"),
        )
        return None
    return _to_pil(base64.b64decode(imgs[0]))


_DISPATCH = {"bria": _bria, "gemini": _gemini, "bedrock": _bedrock}


def generate(prompt: str):
    """concept 프롬프트 → PIL 한 장. provider 미설정/실패면 None(호출자가 폴백).

    호출자는 None 을 '생성 못 함'으로 보고 SVG 도식 바닥을 쓰면 된다(슬롯은 안 빔).
    """
    prov = _provider()
    fn = _DISPATCH.get(prov)
    if not fn:
        return None
    try:
        pil = fn(prompt)
        if pil is None:
            log.info("[generate] %s 응답에 이미지 없음", prov)
        return pil
    except Exception as e:
        log.warning("[generate] %s 생성 실패(무시): %s: %s", prov, type(e).__name__, e)
        return None
