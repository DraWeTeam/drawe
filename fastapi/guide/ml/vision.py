"""ml/vision.py — Gemini VLM 손 *관찰자*. 검출(MediaPipe) 없이 그림을 관찰한다.

원칙(artcoach): 측정=사실, *관찰=가설*, 코칭=서술. 이 관찰은 측정이 아니므로 '관찰(가설)'로만 surface.
신뢰 장치:
  - 구조화 JSON 출력 → 두 번 호출의 일관성을 *기계적으로* 비교(자유 텍스트는 비교 불가).
  - 2회 중 view·structure 가 일치할 때만 confidence='관찰', 아니면 '낮음'(파이프라인이 구체관찰 surface 보류).
  - 출력 방어선: coach 가드레일과 동일한 FORBIDDEN 정책표현이 새면 그 실행 폐기.
게이트: HAND_VLM(기본 0). 백엔드: VLM_BACKEND=aistudio(기본, GEMINI_API_KEY) | vertex(GCP 크레딧, ADC).
  vertex: GOOGLE_CLOUD_PROJECT/LOCATION + GOOGLE_APPLICATION_CREDENTIALS(서비스계정 JSON). 모델·body·응답 동일.

자가검증:  python -m ml.vision --selftest          (키 없이 일관성 로직 테스트)
실시간:    HAND_VLM=1 python -m ml.vision <이미지>   (Gemini 실제 호출)
"""

import os
import io
import re
import json
import time
import base64
import requests
from concurrent.futures import ThreadPoolExecutor

from guide.cache import img_hash, vlm_get, vlm_set
from guide._trace import trace

# 이미지-only·결정적인 VLM 결과(주제 분류·손 관찰)를 sha256(이미지)로 캐시(cache.vlm_*: L1 in-process
# + L2 Redis). 같은 그림을 다른 질문으로 재요청해도 VLM 0회. 최종 가이드 결과는 message/user/growth 에도
# 의존하므로 캐시하지 않는다 — '이미지에만 의존하는 비싼 단계'만 캐시(정확성 불변). transient 실패
# (예외·전 샘플 실패)는 캐시하지 않는다(다음 요청에 재시도).

_MODEL = os.environ.get("GEMINI_VISION_MODEL", "gemini-2.5-flash")
_URL = "https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"

# 백엔드: aistudio(기본, API 키) | vertex(GCP 크레딧, ADC 인증). body·응답 형식은 동일.
_BACKEND = os.environ.get("VLM_BACKEND", "aistudio").strip().lower()
_VX_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
_VX_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
_VX_CREDS = None  # ADC 자격증명 캐시(토큰은 만료 시 자동 refresh)


def _vertex_token():
    """ADC(GOOGLE_APPLICATION_CREDENTIALS 서비스계정 또는 메타데이터)로 OAuth 액세스 토큰."""
    global _VX_CREDS
    from google.auth import default  # pip install google-auth
    from google.auth.transport.requests import Request

    if _VX_CREDS is None:
        _VX_CREDS, _ = default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
    if not _VX_CREDS.valid:
        _VX_CREDS.refresh(Request())
    return _VX_CREDS.token


# 검증된 v2 관찰 프롬프트를 구조화 JSON 으로. verdict 질문 없음, 평가어 금지.
_PROMPT = (
    "그림에 그려진 '손 하나'를 관찰합니다. 평가·판정 금지 — "
    "'부족/어색/틀림/실력/잘함/못함' 같은 말 금지. 보이는 사실만.\n"
    "아래 JSON 객체 하나만 출력하세요(마크다운·설명·코드펜스 없이 순수 JSON):\n"
    "{\n"
    '  "view": "손등"|"손바닥"|"옆면"|"불확실",\n'
    '  "plane_facing": "손 평면이 향하는 방향(짧게, 예: 아래-오른쪽)",\n'
    '  "reaching_at_viewer": "예"|"아니오"|"불확실",  // 손/손가락이 화면 밖 보는 사람 쪽으로 뻗어 깊이(원근) 축이 있나\n'
    '  "parts_compressed": "예"|"아니오"|"불확실",  // 원근 때문에 손가락·손의 길이가 짧게 눌리거나 겹쳐 보이나(정면에서 본 전체 길이가 아님)\n'
    '  "foreshortening": ["단축으로 보이는 부위", ...],  // 참고 메모용, 없으면 []\n'
    '  "structure": "입체"|"평면"|"혼합",\n'
    '  "notes": "보이는 사실 한 문장"\n'
    "}\n"
    'reaching_at_viewer·parts_compressed 는 기하 관찰입니다(잘잘못 아님). 평면으로 펼쳐 정면을 향한 손은 보통 둘 다 "아니오".\n'
    'structure 는 그려진 방식의 관찰입니다(덩어리로 읽히면 "입체", 외곽선 위주면 "평면"). 잘잘못이 아닙니다.\n'
    '보이지 않으면 값에 "불확실". 반드시 JSON 하나만.'
)

# 출력 방어선: coach 가드레일(safety/validate.py)과 동일 어휘. import 실패 시 동일 패턴 폴백.
try:
    from guide.safety.validate import FORBIDDEN
except Exception:  # pragma: no cover
    FORBIDDEN = re.compile(
        r"(초보|실력|등급|점수|재능 ?없|잘 그렸|못 그렸|대신 그려|정답 ?이미지)"
    )

_VIEWS = {"손등", "손바닥", "옆면", "불확실"}
_STRUCT = {"입체", "평면", "혼합", "불확실"}
_YESNO = {"예", "아니오", "불확실"}


def _on():
    return os.environ.get("HAND_VLM", "0").strip().lower() not in (
        "",
        "0",
        "false",
        "no",
    )


def _key():
    return os.environ.get("GEMINI_API_KEY", "")


def _creds_ok():
    """백엔드별 자격 존재 확인. vertex 는 project 만 보고(ADC 인증은 호출 시점), aistudio 는 키."""
    if _BACKEND == "vertex":
        return bool(_VX_PROJECT)
    return bool(_key())


def _vertex_url(model):
    """리전: {loc}-aiplatform.googleapis.com. global: aiplatform.googleapis.com(접두사 없음).
    global 은 용량 인식 라우팅으로 429 를 줄여 권장됨(gemini-2.5-flash 지원)."""
    loc = _VX_LOCATION
    host = (
        "aiplatform.googleapis.com"
        if loc == "global"
        else (loc + "-aiplatform.googleapis.com")
    )
    return (
        "https://"
        + host
        + "/v1/projects/"
        + _VX_PROJECT
        + "/locations/"
        + loc
        + "/publishers/google/models/"
        + model
        + ":generateContent"
    )


def _request(model, body, timeout, key):
    """백엔드별 (url, params, headers) 로 POST. body·응답 형식은 동일."""
    if _BACKEND == "vertex":
        url = _vertex_url(model)
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + _vertex_token(),
        }
        params = {}
    else:
        url = _URL.format(m=model)
        headers = {"Content-Type": "application/json"}
        params = {"key": key}
    return requests.post(
        url, params=params, headers=headers, data=json.dumps(body), timeout=timeout
    )


def _to_b64(image):
    """경로(str) 또는 PIL.Image 를 (base64, mime) 로."""
    if isinstance(image, str):
        with open(image, "rb") as f:
            data = f.read()
        mime = "image/png" if image.lower().endswith(".png") else "image/jpeg"
        return base64.b64encode(data).decode(), mime
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode(), "image/jpeg"


def _redact(msg, key):
    """에러 메시지에서 키 노출 차단(URL 의 ?key= 등)."""
    return msg.replace(key, "***KEY***") if key else msg


def _call(b64, mime, key, model=_MODEL, timeout=90, retries=2, prompt=None):
    """Gemini 호출(aistudio 키 또는 vertex ADC). 429 면 백오프 후 제한 재시도. 에러의 키는 마스킹.
    prompt 미지정이면 손 관찰 프롬프트(_PROMPT). production: 429 가 끝까지면 예외 → 호출부가 삼켜 None(폴백).
    """
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt or _PROMPT},
                    {"inline_data": {"mime_type": mime, "data": b64}},
                ],
            }
        ]
    }
    for attempt in range(retries + 1):
        r = _request(model, body, timeout, key)
        if r.status_code == 429 and attempt < retries:
            time.sleep(2 * (2**attempt))  # 2s, 4s
            continue
        try:
            r.raise_for_status()
        except requests.HTTPError as e:
            body = ""
            try:
                body = " | 응답: " + r.text[:600]
            except Exception:
                pass
            raise requests.HTTPError(_redact(str(e) + body, key)) from None
        j = r.json()
        return j["candidates"][0]["content"]["parts"][0]["text"]


def _parse(raw):
    """모델 텍스트에서 JSON 추출·정규화. 실패하면 None."""
    if not raw:
        return None
    t = raw.strip().replace("```json", "").replace("```", "").strip()
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        d = json.loads(t[a : b + 1])
    except Exception:
        return None
    view = str(d.get("view", "불확실")).strip()
    struct = str(d.get("structure", "불확실")).strip()
    reach = str(d.get("reaching_at_viewer", "불확실")).strip()
    comp = str(d.get("parts_compressed", "불확실")).strip()
    fs = d.get("foreshortening", []) or []
    if not isinstance(fs, list):
        fs = [str(fs)]
    return {
        "view": view if view in _VIEWS else "불확실",
        "plane_facing": str(d.get("plane_facing", "")).strip(),
        "reaching_at_viewer": reach if reach in _YESNO else "불확실",
        "parts_compressed": comp if comp in _YESNO else "불확실",
        "foreshortening": [str(x).strip() for x in fs if str(x).strip()],
        "structure": struct if struct in _STRUCT else "불확실",
        "notes": str(d.get("notes", "")).strip(),
    }


# 단축(foreshortening) = latent concept(VLM이 매 호출 다른 손가락을 지목 = 측정 정의 붕괴)였다.
#   자유 리스트 대신 기하 binary 2개(reaching_at_viewer·parts_compressed)로 grounding → 3단.
#   둘 다 '예'=STRONG, 하나만=WEAK, 아니면 NONE. 자유 리스트는 디버그/표기용만(게이트 미사용).
_TIER_RANK = {"NONE": 0, "WEAK": 1, "STRONG": 2}


def _fs_tier(p):
    r, c = p.get("reaching_at_viewer", "불확실"), p.get("parts_compressed", "불확실")
    if r == "예" and c == "예":
        return "STRONG"
    if "예" in (r, c):
        return "WEAK"
    return "NONE"


_FINGER = {
    "가운데": "중지",
    "중간": "중지",
    "검지": "검지",
    "집게": "검지",
    "약지": "약지",
    "넷째": "약지",
    "새끼": "소지",
    "소지": "소지",
    "엄지": "엄지",
    "첫째": "엄지",
    "중지": "중지",
}


def _norm(s):
    s = s.strip()
    for k, v in _FINGER.items():
        if k in s:
            return v
    return s


def _agree(a, b):
    """일관성: view 만 일치(또는 한쪽이 '불확실')하면 True. structure 는 §2 측정에서 run 간
    흔들림이 확인돼('입체↔혼합' 매번 뒤집힘) 게이트에서 제외. structure 는 표기만 한다.
    foreshortening 도 노이즈가 커서 교집합 결과만 신뢰(아래 strong 판정에 사용).
    """
    if not a or not b:
        return False
    if a["view"] != b["view"] and "불확실" not in (a["view"], b["view"]):
        return False
    return True


# ── 주제 분류(애매한 CLIP 보강용 — 에스컬레이션) ─────────────────────────────────────────────
_SUBJECT_PROMPT = (
    "Classify the MAIN SUBJECT of this drawing or sketch. "
    "Answer with EXACTLY ONE word from: figure, hand, face, landscape, object. "
    "figure=a full or partial human body. hand=a hand or foot close-up. "
    "face=a face or head. landscape=scenery or an outdoor scene. "
    "object=a still life or inanimate object. Output only the one word, nothing else."
)
_SUBJECT_WORDS = {
    "figure": "figure",
    "hand": "hand",
    "face": "face",
    "landscape": "landscape",
    "object": "still_life",
}


def classify_subject(image):
    """주제를 Gemini 1회로 분류 — CLIP 이 애매할 때만 호출부에서 부른다(에스컬레이션 사다리).
    반환: figure/hand/face/landscape/still_life | None. 게이트(SUBJECT_VLM) off·키 없음·실패면 None
    → 호출부가 CLIP 폴백. HAND_VLM 과 같은 키/백엔드(_creds_ok·_key)를 쓴다."""
    if os.environ.get("SUBJECT_VLM", "0").strip().lower() not in ("1", "true", "yes"):
        return None
    if not _creds_ok():
        return None
    h = img_hash(image)
    hit, cached, tier = vlm_get("subject", _MODEL, h)
    if hit:
        trace("vlm.cache", fn="subject", hit=True, tier=tier, val=cached, model=_MODEL)
        return cached
    try:
        b64, mime = _to_b64(image)
        raw = _call(b64, mime, _key(), prompt=_SUBJECT_PROMPT, timeout=30)
    except Exception as e:
        print(f"[vision] 주제 분류 실패(CLIP 폴백): {type(e).__name__}: {e}")
        return None  # transient → 캐시하지 않음(다음에 재시도)
    word = re.sub(r"[^a-z]", "", (raw or "").strip().lower())
    result = None
    for k, v in _SUBJECT_WORDS.items():
        if k in word:
            result = v
            break
    vlm_set("subject", _MODEL, h, result)  # 결정적 결과(매칭 실패 None 포함) 캐시
    trace("vlm.cache", fn="subject", hit=False, tier="miss", val=result, model=_MODEL)
    return result


# ── 스타일 분류(애매한 CLIP 보강용 — 에스컬레이션) ────────────────────────────────────────────
#   비례(proportion) 노름은 스타일마다 다르다(사실체 7~8등신 ↔ 애니 다리 길게 ↔ 치비 머리 큼).
#   CLIP 은 수수한 회색 만화(색·렌더 단서 약함)에서 anime↔realistic 을 자신있게 못 가른다(실측
#   figure_002 anime 0.56) → 그 애매대역에서만 VLM 1회로 스타일을 확정한다(subject 와 같은 사다리).
_STYLE_PROMPT = (
    "Classify the ART STYLE of this character drawing. "
    "Answer with EXACTLY ONE word from: realistic, anime, chibi. "
    "realistic=natural human proportions (about 7-8 heads tall). "
    "anime=stylized manga or anime character (often long legs, about 6-7 heads). "
    "chibi=super-deformed, very large head and small short body (about 2-4 heads). "
    "Output only the one word, nothing else."
)
_STYLE_WORDS = {"realistic": "realistic", "anime": "anime", "chibi": "chibi"}


def classify_style(image):
    """캐릭터 그림의 스타일을 Gemini 1회로 분류 — CLIP 이 애매할 때만 호출부에서 부른다.
    반환: realistic/anime/chibi | None. 게이트(STYLE_VLM) off·키 없음·실패·미매칭이면 None
    → 호출부가 '스타일 미상'으로 보고 norm 자동발화를 끈다(_NORM_OFF, abstain)."""
    if os.environ.get("STYLE_VLM", "0").strip().lower() not in ("1", "true", "yes"):
        return None
    if not _creds_ok():
        return None
    h = img_hash(image)
    hit, cached, tier = vlm_get("style", _MODEL, h)
    if hit:
        trace("vlm.cache", fn="style", hit=True, tier=tier, val=cached, model=_MODEL)
        return cached
    try:
        b64, mime = _to_b64(image)
        raw = _call(b64, mime, _key(), prompt=_STYLE_PROMPT, timeout=30)
    except Exception as e:
        print(f"[vision] 스타일 분류 실패(스타일 미상): {type(e).__name__}: {e}")
        return None  # transient → 캐시하지 않음
    word = re.sub(r"[^a-z]", "", (raw or "").strip().lower())
    result = None
    for k, v in _STYLE_WORDS.items():
        if k in word:
            result = v
            break
    vlm_set("style", _MODEL, h, result)  # 결정적 결과(미매칭 None 포함) 캐시
    trace("vlm.cache", fn="style", hit=False, tier="miss", val=result, model=_MODEL)
    return result


def observe_hand(image, runs=2):
    """그림 속 손 하나를 관찰(가설). 게이트 off·키 없음·전부 실패면 None.
    반환: dict(view, plane_facing, foreshortening, structure, notes, consistent, confidence, runs_used).
    foreshortening 은 두 실행의 *교집합*만 남긴다(일관된 단축만 신뢰).
    """
    if not _on() or not _creds_ok():
        # [게이트 가시화] 여기서 조용히 None 반환하던 게 'observe_hand 가 아예 안 보이는' 증상의 후보.
        #   on(HAND_VLM)·creds(키/프로젝트)·backend 를 남겨, 게이트 탈락이면 한 줄로 드러나게 한다.
        trace("hand.vlm.gate", on=_on(), creds=_creds_ok(), backend=_BACKEND)
        return None
    h = img_hash(image)
    hit, cached, tier = vlm_get("hand", _MODEL, h)
    if hit:
        trace("vlm.cache", fn="hand", hit=True, tier=tier, model=_MODEL)
        return cached
    b64, mime = _to_b64(image)
    key = _key()

    def _sample(_):
        # 관찰 1회: 호출→파싱→방어선. 실패는 None(상위에서 거른다).
        try:
            raw = _call(b64, mime, key)
        except Exception:
            return None
        p = _parse(raw)
        if not p:
            return None
        if FORBIDDEN.search(p["notes"] + " " + p["plane_facing"]):  # 방어선
            return None
        return p

    # runs 회는 서로 독립적인 일관성 샘플이라 순차일 이유가 없다 → 동시에 호출해 VLM 지연을
    # 순차 합(≈2회분)에서 ≈1회분으로 줄인다. map 은 입력 순서를 보존하므로 parsed[0]=첫 실행(base) 의미 유지.
    with ThreadPoolExecutor(max_workers=runs) as ex:
        parsed = [p for p in ex.map(_sample, range(runs)) if p is not None]
    if not parsed:
        return None

    base = parsed[0]
    consistent = len(parsed) >= 2 and _agree(parsed[0], parsed[1])
    # [§2 측정] VLM 이 '일관된 구조 추출기'인가 — _agree 는 view·structure(거친 축)만 본다. 미세 필드
    #   (plane_facing·foreshortening)가 거친 일치 속에서도 흔들리는지 두 실행을 나란히 노출해 확인한다.
    # 단축 3단: 두 run 의 기하-binary tier 보수 합의(min rank). view 일치와 *독립* — 단축은 깊이
    #   관찰이라 손등/손바닥을 알 필요 없다(view-coupling 제거). 둘 다 STRONG 이어야 STRONG.
    tiers = [_fs_tier(p) for p in parsed[:2]]
    fs_tier = (
        min(tiers, key=lambda t: _TIER_RANK[t]) if len(tiers) >= 2 else _fs_tier(base)
    )
    trace(
        "hand.vlm",
        runs=len(parsed),
        consistent=consistent,
        views=[p["view"] for p in parsed],
        structures=[p["structure"] for p in parsed],
        facings=[p["plane_facing"] for p in parsed],
        reach=[p["reaching_at_viewer"] for p in parsed],
        compressed=[p["parts_compressed"] for p in parsed],
        fs_tier=fs_tier,
        foreshort=[p["foreshortening"] for p in parsed],  # 디버그 raw(게이트 미사용)
    )
    # confidence(view 기반 — view/structure surface 게이트). 단축 surface 는 fs_tier 가 따로 담당.
    #   가드: view·structure 둘 다 '불확실'이면 '일관된 무관찰' → 낮음(손 없는 그림 거짓 surface 차단).
    empty_obs = base["view"] == "불확실" and base["structure"] == "불확실"
    if empty_obs:
        confidence = "낮음"
    elif consistent:
        confidence = "관찰" if fs_tier != "NONE" else "관찰(약)"
    else:
        confidence = "낮음"
    result = {
        "model": _MODEL,
        "view": base["view"],
        "plane_facing": base["plane_facing"],
        "reaching_at_viewer": base["reaching_at_viewer"],
        "parts_compressed": base["parts_compressed"],
        "foreshortening_tier": fs_tier,  # 단축 surface 게이트(view 독립, 안정)
        "foreshortening": base[
            "foreshortening"
        ],  # 디버그/표기용 raw(게이트엔 미사용 — 측정 정의 붕괴)
        "structure": base[
            "structure"
        ],  # 표기는 하되 게이트엔 안 씀(§2: structure 불안정)
        "notes": base["notes"] if consistent else "",
        "consistent": consistent,
        "confidence": confidence,
        "runs_used": len(parsed),
    }
    vlm_set(
        "hand", _MODEL, h, result
    )  # 성공 관찰만 캐시(위 'parsed 없음' transient 는 미캐시)
    trace("vlm.cache", fn="hand", hit=False, tier="miss", model=_MODEL)
    return result


# ── 얼굴 관찰자(observe_hand 패턴 이식) ───────────────────────────────────────────────────
#   face 검출도 mediapipe(FaceLandmarker)가 드로잉에 약함(실측 2/3, 측면·스타일화 미검출) →
#   hand 와 동일하게 VLM 관찰로 간다. 하이브리드(landmark+VLM 합류)는 새 confabulation 진입로라
#   기각. 측정=사실이 아니라 *관찰(가설)* 이므로 placeholder 로 measured=False surface.
#   가드(hand 보다 더 단단히): view·eye_line 둘 다 불확실이거나 초상 아니면 '낮음'(abstain).
_FACE_PROMPT = (
    "그림의 주 대상이 '얼굴/머리 초상'인지 관찰하고, 맞으면 얼굴을 관찰합니다. 평가·판정 금지 — "
    "'부족/어색/틀림/실력/잘함/못함' 같은 말 금지. 보이는 사실만.\n"
    "아래 JSON 객체 하나만 출력(마크다운·설명·코드펜스 없이 순수 JSON):\n"
    "{\n"
    '  "is_portrait": true|false,  // 주 대상이 얼굴/머리 초상이면 true, 전신 인물·사물·풍경이면 false\n'
    '  "view": "정면"|"측면"|"3/4"|"불확실",\n'
    '  "eye_line": "위"|"중앙"|"아래"|"불확실",  // 머리끝~턱 사이에서 눈높이의 위치(절반보다 위면 "위")\n'
    '  "notes": "보이는 사실 한 문장"\n'
    "}\n"
    "eye_line 은 그려진 눈 높이의 관찰입니다(잘잘못 아님). 전신 인물·사물이면 is_portrait=false.\n"
    '보이지 않으면 값에 "불확실". 반드시 JSON 하나만.'
)
_FVIEWS = {"정면", "측면", "3/4", "불확실"}
_EYELINE = {"위", "중앙", "아래", "불확실"}


def _face_on():
    return os.environ.get("FACE_VLM", "0").strip().lower() not in (
        "",
        "0",
        "false",
        "no",
    )


def _parse_face(text):
    t = (text or "").strip()
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        d = json.loads(t[a : b + 1])
    except Exception:
        return None
    view = str(d.get("view", "불확실")).strip()
    eye = str(d.get("eye_line", "불확실")).strip()
    return {
        "is_portrait": bool(d.get("is_portrait", False)),
        "view": view if view in _FVIEWS else "불확실",
        "eye_line": eye if eye in _EYELINE else "불확실",
        "notes": str(d.get("notes", "")).strip(),
    }


def _face_agree(a, b):
    """일관성: view 일치(또는 한쪽 '불확실')하고 둘 다 초상으로 봤을 때만 True."""
    if not a or not b:
        return False
    if not (a["is_portrait"] and b["is_portrait"]):
        return False
    if a["view"] != b["view"] and "불확실" not in (a["view"], b["view"]):
        return False
    return True


def observe_face(image, runs=2):
    """그림 속 얼굴/머리 초상을 관찰(가설). 게이트 off·키 없음·전부 실패·초상 아님이면 낮음/None.
    반환: dict(is_portrait, view, eye_line, notes, consistent, confidence, runs_used, model).
    confidence ∈ {관찰, 관찰(약), 낮음}. 라우팅(검출)·신호(측정) 양쪽이 이 한 결과를 캐시로 공유한다."""
    if not _face_on() or not _creds_ok():
        trace("face.vlm.gate", on=_face_on(), creds=_creds_ok(), backend=_BACKEND)
        return None
    h = img_hash(image)
    hit, cached, tier = vlm_get("face", _MODEL, h)
    if hit:
        trace("vlm.cache", fn="face", hit=True, tier=tier, model=_MODEL)
        return cached
    parsed = []
    for _ in range(max(1, runs)):
        try:
            b64, mime = _to_b64(image)
            raw = _call(b64, mime, _key(), prompt=_FACE_PROMPT, timeout=60)
        except Exception as e:
            print(f"[vision] 얼굴 관찰 호출 실패(무시): {type(e).__name__}: {e}")
            continue
        p = _parse_face(raw)
        if p:
            parsed.append(p)
    if not parsed:
        return None  # transient → 미캐시
    base = parsed[0]
    consistent = len(parsed) >= 2 and _face_agree(parsed[0], parsed[1])
    trace(
        "face.vlm",
        runs=len(parsed),
        consistent=consistent,
        portrait=[p["is_portrait"] for p in parsed],
        views=[p["view"] for p in parsed],
        eyes=[p["eye_line"] for p in parsed],
    )
    # 가드: 초상 아님 또는 view·eye_line 둘 다 불확실 → '낮음'(관찰된 것 없음). hand 의 empty_obs 강화판.
    empty_obs = base["view"] == "불확실" and base["eye_line"] == "불확실"
    if not base["is_portrait"] or empty_obs:
        confidence = "낮음"
    elif consistent:
        confidence = "관찰" if base["eye_line"] != "불확실" else "관찰(약)"
    else:
        confidence = "낮음"
    result = {
        "model": _MODEL,
        "is_portrait": base["is_portrait"],
        "view": base["view"],
        "eye_line": base["eye_line"],
        "notes": base["notes"] if consistent else "",
        "consistent": consistent,
        "confidence": confidence,
        "runs_used": len(parsed),
    }
    vlm_set("face", _MODEL, h, result)
    trace("vlm.cache", fn="face", hit=False, tier="miss", model=_MODEL)
    return result


# ── 포즈 관찰자(observe_hand/face 패턴 이식) ──────────────────────────────────────────────
#   BlazePose(MediaPipe PoseLandmarker)가 해부도·선화 인물에 *아예 응답 안 함*(실측 4/6
#   no_person_detected, kp=0 — 퇴화 스켈레톤도 아닌 순수 미검출) → 임계 튜닝으론 못 살림.
#   hand/face 와 동일하게 VLM 관찰로 간다. 측정 아니라 *관찰(가설)* → placeholder measured=False.
#   ★검출 복구가 아니라 *주제 표면화*: 키포인트 복원→기존 스코어러는 트리거가 정반대(s_action_line은
#   '너무 정적'에 발화, 라벨은 역동 포즈에 동세를 기대) → VLM은 style-invariant 성격(역동/균형)만
#   positive-only 로 관찰해 주제로 올린다. 정적·안정·중립엔 침묵(chibi/normal over-fire 방지).
#   가드(face 동형): 전신/부분 인물 아님(is_full_body=false) 또는 dynamism·balance 둘 다 불확실 → '낮음'.
_POSE_PROMPT = (
    "그림의 주 대상이 '전신 또는 부분 인물(몸)'인지 관찰하고, 맞으면 포즈의 성격을 관찰합니다. "
    "평가·판정 금지 — '부족/어색/틀림/실력/잘함/못함' 같은 말 금지. 보이는 사실만.\n"
    "아래 JSON 객체 하나만 출력(마크다운·설명·코드펜스 없이 순수 JSON):\n"
    "{\n"
    '  "is_full_body": true|false,  // 주 대상이 전신·반신 등 몸이 보이는 인물이면 true, 얼굴만·사물·풍경이면 false\n'
    '  "dynamism": "동적"|"정적"|"불확실",  // 걷기·달리기·기울임 등 움직임이 느껴지면 "동적", 직립·정지면 "정적"\n'
    '  "balance": "안정"|"불안정"|"불확실",  // 한 발 지지·뚜렷한 무게 쏠림이면 "불안정", 양발 고른 지지면 "안정"\n'
    '  "notes": "보이는 사실 한 문장"\n'
    "}\n"
    "dynamism·balance 는 포즈 성격의 관찰입니다(잘잘못 아님). 얼굴만·사물·풍경이면 is_full_body=false.\n"
    '보이지 않으면 값에 "불확실". 반드시 JSON 하나만.'
)
_DYNAMISM = {"동적", "정적", "불확실"}
_BALANCE = {"안정", "불안정", "불확실"}


def _pose_on():
    return os.environ.get("POSE_VLM", "0").strip().lower() not in (
        "",
        "0",
        "false",
        "no",
    )


def _parse_pose(text):
    t = (text or "").strip()
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        d = json.loads(t[a : b + 1])
    except Exception:
        return None
    dyn = str(d.get("dynamism", "불확실")).strip()
    bal = str(d.get("balance", "불확실")).strip()
    return {
        "is_full_body": bool(d.get("is_full_body", False)),
        "dynamism": dyn if dyn in _DYNAMISM else "불확실",
        "balance": bal if bal in _BALANCE else "불확실",
        "notes": str(d.get("notes", "")).strip(),
    }


def _pose_agree(a, b):
    """일관성: 둘 다 전신 인물로 봤고, dynamism·balance 가 일치(또는 한쪽 '불확실')할 때만 True.
    (face 의 _face_agree 동형 — is_portrait→is_full_body, view→dynamism/balance 두 축.)"""
    if not a or not b:
        return False
    if not (a["is_full_body"] and b["is_full_body"]):
        return False
    if a["dynamism"] != b["dynamism"] and "불확실" not in (
        a["dynamism"],
        b["dynamism"],
    ):
        return False
    if a["balance"] != b["balance"] and "불확실" not in (a["balance"], b["balance"]):
        return False
    return True


def observe_pose(image, runs=2):
    """그림 속 인물 포즈의 *성격*을 관찰(가설). 게이트 off·키 없음·전부 실패·비인물이면 낮음/None.
    반환: dict(is_full_body, dynamism, balance, notes, consistent, confidence, runs_used, model).
    confidence ∈ {관찰, 관찰(약), 낮음}. positive-only 발화는 호출부(_vlm_pose_signal)에서."""
    if not _pose_on() or not _creds_ok():
        trace("pose.vlm.gate", on=_pose_on(), creds=_creds_ok(), backend=_BACKEND)
        return None
    h = img_hash(image)
    hit, cached, tier = vlm_get("pose", _MODEL, h)
    if hit:
        trace("vlm.cache", fn="pose", hit=True, tier=tier, model=_MODEL)
        return cached
    parsed = []
    for _ in range(max(1, runs)):
        try:
            b64, mime = _to_b64(image)
            raw = _call(b64, mime, _key(), prompt=_POSE_PROMPT, timeout=60)
        except Exception as e:
            print(f"[vision] 포즈 관찰 호출 실패(무시): {type(e).__name__}: {e}")
            continue
        p = _parse_pose(raw)
        if p:
            parsed.append(p)
    if not parsed:
        return None  # transient → 미캐시
    base = parsed[0]
    consistent = len(parsed) >= 2 and _pose_agree(parsed[0], parsed[1])
    trace(
        "pose.vlm",
        runs=len(parsed),
        consistent=consistent,
        full=[p["is_full_body"] for p in parsed],
        dyn=[p["dynamism"] for p in parsed],
        bal=[p["balance"] for p in parsed],
    )
    # 가드: 전신 인물 아님 또는 dynamism·balance 둘 다 불확실 → '낮음'(관찰된 것 없음). face 의 empty_obs 동형.
    empty_obs = base["dynamism"] == "불확실" and base["balance"] == "불확실"
    if not base["is_full_body"] or empty_obs:
        confidence = "낮음"
    elif consistent:
        # 신뢰 3단: 두 성격 다 definite면 "관찰", 한쪽만 definite면 "관찰(약)"(단정 회피).
        both = base["dynamism"] != "불확실" and base["balance"] != "불확실"
        confidence = "관찰" if both else "관찰(약)"
    else:
        confidence = "낮음"
    result = {
        "model": _MODEL,
        "is_full_body": base["is_full_body"],
        "dynamism": base["dynamism"],
        "balance": base["balance"],
        "notes": base["notes"] if consistent else "",
        "consistent": consistent,
        "confidence": confidence,
        "runs_used": len(parsed),
    }
    vlm_set("pose", _MODEL, h, result)
    trace("vlm.cache", fn="pose", hit=False, tier="miss", model=_MODEL)
    return result


def _selftest():
    """키 없이 파싱·일관성 로직 검증."""
    r1 = '{"view":"손등","plane_facing":"아래-오른쪽","foreshortening":["중지","약지"],"structure":"입체","notes":"손등이 보인다"}'
    r2 = '```json\n{"view":"손등","plane_facing":"오른쪽 아래","foreshortening":["가운데 손가락","약지"],"structure":"입체","notes":"손등 보임"}\n```'
    r3 = '{"view":"손바닥","plane_facing":"위","foreshortening":[],"structure":"평면","notes":"x"}'
    a, b, c = _parse(r1), _parse(r2), _parse(r3)
    assert a and b and c, "parse 실패"
    assert _agree(a, b) is True, "일치해야 함(view·structure 같음)"
    assert _agree(a, c) is False, "불일치여야 함(view·structure 다름)"
    # 단축 교집합: 중지·약지 (가운데→중지 정규화)
    inter = [
        x
        for x in a["foreshortening"]
        if _norm(x) in {_norm(y) for y in b["foreshortening"]}
    ]
    assert set(_norm(x) for x in inter) == {"중지", "약지"}, f"교집합 오류: {inter}"
    # 정책표현 방어선
    assert FORBIDDEN.search("이건 실력이 부족"), "FORBIDDEN 동작 확인"
    # 포즈 관찰자: 파싱·일관성(전신+성격 일치)·비인물 가드
    p1 = _parse_pose(
        '{"is_full_body":true,"dynamism":"동적","balance":"불안정","notes":"걷는 포즈"}'
    )
    p2 = _parse_pose(
        '```json\n{"is_full_body":true,"dynamism":"동적","balance":"불확실","notes":"걷는다"}\n```'
    )
    p3 = _parse_pose(
        '{"is_full_body":false,"dynamism":"불확실","balance":"불확실","notes":"얼굴만"}'
    )
    assert p1 and p2 and p3, "pose parse 실패"
    assert _pose_agree(p1, p2) is True, (
        "일치해야 함(전신+동적, balance 한쪽 불확실 허용)"
    )
    assert _pose_agree(p1, p3) is False, "불일치여야 함(p3 비전신)"
    assert p1["dynamism"] == "동적" and p1["balance"] == "불안정", "pose 값 정규화 오류"
    # 단축 3단(기하 binary grounding — 자유 리스트 대신): 둘 다 예=STRONG, 하나=WEAK, 없음=NONE
    assert (
        _fs_tier({"reaching_at_viewer": "예", "parts_compressed": "예"}) == "STRONG"
    ), "STRONG 오류"
    assert (
        _fs_tier({"reaching_at_viewer": "예", "parts_compressed": "아니오"}) == "WEAK"
    ), "WEAK 오류"
    assert (
        _fs_tier({"reaching_at_viewer": "아니오", "parts_compressed": "아니오"})
        == "NONE"
    ), "NONE 오류"
    assert (
        _fs_tier({"reaching_at_viewer": "불확실", "parts_compressed": "불확실"})
        == "NONE"
    ), "불확실→NONE 오류"
    print("selftest OK — 파싱·일관성·교집합·방어선·포즈·단축3단 정상")


if __name__ == "__main__":
    import sys

    args = sys.argv[1:]
    if "--selftest" in args:
        _selftest()
        raise SystemExit
    os.environ.setdefault("HAND_VLM", "1")  # 수동 실행 편의
    paths = [a for a in args if not a.startswith("--")]
    if not paths:
        print(
            "사용: HAND_VLM=1 python -m ml.vision <이미지>  |  python -m ml.vision --selftest"
        )
        raise SystemExit
    for p in paths:
        out = observe_hand(p, runs=2)
        print(f"\n[{os.path.basename(p)}]")
        print(
            json.dumps(out, ensure_ascii=False, indent=2)
            if out
            else "None (게이트 off / 키 없음 / 호출·파싱 실패)"
        )
