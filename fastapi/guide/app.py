"""guide/app.py — guide 서비스 엔트리(embed/main.py 와 *별도*).

띄우기:  uvicorn guide.app:app --host 0.0.0.0 --port 8000
- 워밍업을 *백그라운드*로 돌려 서버는 즉시 기동 → /health 가 loading(503) 을 보고하다가
  ready 되면 ok(200). (lifespan 에서 await 로 막으면 그동안 서버가 안 떠서 loading 을 못 본다.)
- SIGTERM(spot 2분 통지) 시 draining 으로 전환해 신규 요청을 끊는다.
- P0: 파이프라인 미이식 → NotImplementedError 를 깔끔한 501 로 매핑(라우트는 살아있음).
"""
import signal
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("drawe-fastapi.guide")


class _Runtime:
    ready = False       # 워밍업 완료 → 비로소 트래픽
    draining = False    # SIGTERM 수신 → 신규 거절(in-flight 만 마무리)


rt = _Runtime()


def _on_sigterm(*_):
    rt.draining = True
    log.warning("SIGTERM -> DRAINING (guide)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    signal.signal(signal.SIGTERM, _on_sigterm)

    async def _warm():
        try:
            from guide.warmup import warmup_guide
            await asyncio.to_thread(warmup_guide)   # blocking 모델 로드 → 워커 스레드
            rt.ready = True
            log.info("guide warmup complete")
        except Exception:
            log.exception("guide warmup failed")

    app.state._warm_task = asyncio.create_task(_warm())  # 백그라운드 → 서버 즉시 기동
    yield
    # 종료: draining 은 SIGTERM 에서 set. in-flight 는 uvicorn graceful-shutdown 이 마무리.


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    # ECS healthCheck / Service Connect 가 이 결과로 라우팅을 붙이고 뗀다.
    if rt.draining:
        return JSONResponse({"status": "draining"}, status_code=503)
    if not rt.ready:
        return JSONResponse({"status": "loading"}, status_code=503)
    return {"status": "ok"}


@app.exception_handler(NotImplementedError)
async def _not_implemented(request: Request, exc: NotImplementedError):
    # P0: facade 미구현 → 500 대신 깔끔한 501. P1 포트 후 자연 소멸.
    return JSONResponse({"detail": f"not implemented yet: {exc}"}, status_code=501)


# guide 라우터(현재 /guide 는 facade 미구현 → 501. 라우팅·운영만 살아있음)
from guide.routes import router as guide_router  # noqa: E402
app.include_router(guide_router)
