from functools import lru_cache
import hashlib
import json
import os
from collections import OrderedDict
import numpy as np
from guide.ml.embed import embedder


@lru_cache(maxsize=4096)
def _text_vec_cached(text: str, model_id: str) -> bytes:
    return embedder.text(text).astype("float32").tobytes()


def text_vec(text: str) -> np.ndarray:
    return np.frombuffer(_text_vec_cached(text, embedder.model_id), dtype="float32")


def img_hash(pil) -> str:
    return hashlib.sha256(pil.tobytes()).hexdigest()[:16]


# ── 이미지-only·결정적 VLM 결과 캐시(2단: in-process L1 + Redis L2) ─────────────────────────
# 왜: classify_subject·observe_hand 는 이미지에만 의존 → 같은 그림 재요청 시 VLM 0회. L2(Redis)는
# 재배포·재시작에도 캐시가 살아남는다(인메모리만 쓰면 배포마다 비용 재발생). Redis 없으면 L1만으로 동작.
# 연결은 _ratelimit.py 패턴 재사용(lazy import → from_url → ping → 실패 시 폴백, 절대 예외 안 던짐).
_VLM_L1_MAX = 512
_VLM_L1: "OrderedDict[str, object]" = OrderedDict()
_VLM_TTL = int(os.environ.get("VLM_CACHE_TTL", "2592000"))  # 30일(이미지 해시는 불변)
_MISS = object()
_redis_client = _MISS  # lazy 싱글톤


def _redis_url() -> str:
    """REDIS_URL 우선, 없으면 REDIS_HOST/PORT/PASSWORD 로 조립(로컬 compose ↔ dev/prod 양쪽 호환)."""
    u = os.environ.get("REDIS_URL", "").strip()
    if u:
        return u
    host = os.environ.get("REDIS_HOST", "").strip()
    if not host:
        return ""
    port = os.environ.get("REDIS_PORT", "6379").strip()
    pw = os.environ.get("REDIS_PASSWORD", "").strip()
    db = os.environ.get("REDIS_DB", "0").strip()
    auth = f":{pw}@" if pw else ""
    return f"redis://{auth}{host}:{port}/{db}"


def _client():
    global _redis_client
    if _redis_client is _MISS:
        _redis_client = None
        url = _redis_url()
        if url:
            try:
                import redis  # lazy: 설정됐을 때만

                c = redis.Redis.from_url(
                    url, socket_connect_timeout=1, decode_responses=True
                )
                c.ping()
                _redis_client = c
                print("[cache] VLM 캐시 Redis(L2) 연결 OK")
            except Exception as e:
                print(
                    f"[cache] Redis 연결 실패 → L1(in-process)만 사용: {type(e).__name__}: {e}"
                )
    return _redis_client


def _l1_get(k):
    if k in _VLM_L1:
        _VLM_L1.move_to_end(k)
        return True, _VLM_L1[k]
    return False, None


def _l1_put(k, v):
    _VLM_L1[k] = v
    _VLM_L1.move_to_end(k)
    while len(_VLM_L1) > _VLM_L1_MAX:
        _VLM_L1.popitem(last=False)


def vlm_get(ns: str, model: str, key: str):
    """(hit, value, tier). tier ∈ l1|l2|miss. Redis 장애는 조용히 L1 폴백.
    키에 model 을 포함해 모델 전환 시 캐시 자동 분리(flash-lite 답이 flash 요청에 hit 되던 문제 차단)."""
    k = f"vlm:{ns}:{model}:{key}"
    ok, v = _l1_get(k)
    if ok:
        return True, v, "l1"
    c = _client()
    if c is not None:
        try:
            raw = c.get(k)
            if raw is not None:
                v = json.loads(raw)
                _l1_put(k, v)  # L2 hit → L1 승격
                return True, v, "l2"
        except Exception:
            pass
    return False, None, "miss"


def vlm_set(ns: str, model: str, key: str, value) -> None:
    """결정적 결과만 저장(호출부가 transient 실패는 안 부른다). value 는 JSON 직렬화 가능해야 함.
    키에 model 포함(vlm_get 과 동일 체계) — 모델별 캐시 분리."""
    k = f"vlm:{ns}:{model}:{key}"
    _l1_put(k, value)
    c = _client()
    if c is not None:
        try:
            c.setex(k, _VLM_TTL, json.dumps(value, ensure_ascii=False))
        except Exception:
            pass
