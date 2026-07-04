"""LLM 어댑터. provider 미설정 시 DummyLLM(오프라인 템플릿)로 동작.
DummyLLM은 프롬프트에 주입된 <<OBS>>/<<REFS>> 마커를 읽어 근거 있는 GuideResponse JSON을 만든다
→ API 키 없이도 end-to-end가 돌고, 출력은 §20 검증을 통과한다."""

import json
import re
import requests
from guide.config import settings
from guide._trace import trace

_OBS = re.compile(r"<<OBS>>(.*?)<<END>>", re.S)
_REFS = re.compile(r"<<REFS>>(.*?)<<END>>", re.S)


def _default_effect(sub_problem):
    """오프라인/폴백용: taxonomy의 근거 있는 기본 effect (없으면 빈 문자열)."""
    try:
        from guide.pipeline.diagnose import taxonomy

        return taxonomy().get(sub_problem, {}).get("default_effect", "")
    except Exception:
        return ""


class DummyLLM:
    def complete_json(self, prompt: str) -> str:
        mo, mr = _OBS.search(prompt), _REFS.search(prompt)
        if not mo:
            return json.dumps({"mode": "clarify", "message": "무엇을 봐주면 좋을까요?"})
        obs = json.loads(mo.group(1))
        refs = json.loads(mr.group(1)) if mr else {}
        blocks = []
        for o in obs.get("observations", []):
            sp = o["sub_problem"]
            sig = (o.get("signal") or "").strip()
            # measured=True + signal 있으면 측정 사실을 관찰로(구체). 아니면 일반 관찰 힌트(단정 X·누출 X).
            observation = sig if (o.get("measured") and sig) else o["what_to_observe"]
            blocks.append(
                {
                    "sub_problem": sp,
                    "observation": observation,
                    "effect": _default_effect(sp),
                    "direction": o["practice_prompt"],
                    "reference_ids": (refs.get(sp) or [])[:2],
                    "confidence": o["confidence"],
                }
            )
        return json.dumps(
            {
                "mode": "coach",
                "primary_focus": obs.get("primary_focus"),
                "degraded": obs.get("degraded", False),
                "blocks": blocks,
                "one_thing": blocks[0]["direction"] if blocks else None,
            },
            ensure_ascii=False,
        )

    def stream(self, prompt: str):
        out = self.complete_json(prompt)
        for i in range(0, len(out), 24):
            yield out[i : i + 24]


_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")
_OBJ = re.compile(r"\{.*\}", re.S)


def _extract_json(text: str) -> str:
    """모델 출력에서 GuideResponse JSON만 추출(코드펜스/서두·후미 텍스트 제거)."""
    t = (text or "").strip()
    t = _FENCE.sub("", t).strip()
    if not t.startswith("{"):
        m = _OBJ.search(t)
        if m:
            t = m.group(0)
    return t


XAI_URL = "https://api.x.ai/v1/chat/completions"


class RealLLM:
    """xAI(Grok) 연결. OpenAI 호환 chat/completions. 실패 시 DummyLLM(근거 템플릿)로 폴백."""

    def __init__(self):
        self.key = settings.xai_api_key
        self.model = settings.llm_model or "grok-4.3"
        self._fallback = DummyLLM()

    def complete_json(self, prompt: str) -> str:
        # [경계5] llm: 프롬프트 크기 + 폴백 여부. fallback=True면 '결과가 안 나온다'가
        #   컨텍스트 문제가 아니라 Grok 미연결/실패 문제 — 이 한 줄이 둘을 즉시 가른다.
        trace("llm.in", prompt_chars=len(prompt), provider="grok")
        if not self.key:
            trace("llm.out", fallback=True, reason="no_key")
            return self._fallback.complete_json(prompt)
        try:
            r = requests.post(
                XAI_URL,
                headers={
                    "Authorization": f"Bearer {self.key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You output only a single valid JSON object. No markdown, no code fences, no prose.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 8000,  # was 4000 — grok-4.3는 reasoning 모델이라 추론+출력이 토큰을 공유. 4000이면 추론이 먹고 JSON이 잘려(finish=length) primary_focus 누락 → 검증 탈락. 넉넉히.
                },
                timeout=90,
            )
            r.raise_for_status()
            data = r.json()
            choice = data["choices"][0]
            content = choice["message"]["content"]
            # 디버그(원인 확정 후 제거 가능): 잘렸는지(finish=length) + 추론이 토큰을 얼마나 먹었는지.
            #   finish=length → max_tokens 더 올리거나 추론 줄이기. finish=stop인데도 None이면 프롬프트/grounding 문제.
            print(
                f"[llm] grok finish={choice.get('finish_reason')} "
                f"clen={len(content or '')} "
                f"reasoning={(data.get('usage') or {}).get('completion_tokens_details', {}).get('reasoning_tokens')}"
            )
            out = _extract_json(content)
            trace(
                "llm.out",
                fallback=False,
                out_chars=len(out),
                finish=choice.get("finish_reason"),
            )
            return out
        except Exception as e:
            print(f"[llm] Grok 호출 실패 → 템플릿 폴백: {type(e).__name__}: {e}")
            trace("llm.out", fallback=True, reason=type(e).__name__)
            return self._fallback.complete_json(prompt)

    def stream(self, prompt: str):
        out = self.complete_json(prompt)
        for i in range(0, len(out), 24):
            yield out[i : i + 24]


def get_llm():
    # 시작 시 어떤 LLM이 활성인지 로그 — 'Grok 붙었나?'를 docker compose logs api 에서 바로 확인.
    if settings.llm_provider:
        llm = RealLLM()
        key_state = (
            "set" if llm.key else "MISSING(.env XAI_API_KEY 비었음 → 템플릿 폴백)"
        )
        print(
            f"[llm] provider={settings.llm_provider} model={llm.model} key={key_state}"
        )
        return llm
    print(
        "[llm] LLM_PROVIDER 미설정 → DummyLLM(오프라인 템플릿). "
        "Grok 쓰려면 .env에 LLM_PROVIDER=grok 설정 후 컨테이너 재생성하세요."
    )
    return DummyLLM()
