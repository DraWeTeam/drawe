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
import os
from contextlib import asynccontextmanager

from opentelemetry.instrumentation.logging import LoggingInstrumentor

# opentelemetry-instrument 가 startup 에 LoggingInstrumentor 를 이미 instrument 하므로
# (중복 instrument 는 no-op) set_logging_format 인자만으론 포맷이 안 먹는다(실측). LogRecordFactory
# 로 otelTraceID/otelSpanID 는 이미 주입되니, root 로깅 포맷만 force 로 덮어써 출력한다.
# uvicorn 은 root 핸들러를 재구성하지 않아 앱 로그(propagate)에 반영된다.
LoggingInstrumentor().instrument()
logging.basicConfig(format=os.environ.get("OTEL_PYTHON_LOG_FORMAT"), force=True)
# root 는 WARNING 유지(라이브러리 INFO 억제)하고 앱 로거 계열(drawe-fastapi.*)만 INFO 로
# 올린다. 그래야 앱 로그가 trace context 를 실어 stdout·Loki 에 나온다(basicConfig 기본
# level=WARNING 이라 안 하면 앱 INFO 가 억제됨 — 실측). drawe-fastapi.guide 는 prefix 상속.
logging.getLogger("drawe-fastapi").setLevel(logging.INFO)

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

log = logging.getLogger("drawe-fastapi.guide")


class _Runtime:
    ready = False  # 워밍업 완료 → 비로소 트래픽
    draining = False  # SIGTERM 수신 → 신규 거절(in-flight 만 마무리)


rt = _Runtime()


def _on_sigterm(*_):
    rt.draining = True
    log.warning("SIGTERM -> DRAINING (guide)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    signal.signal(signal.SIGTERM, _on_sigterm)

    async def _warm():
        try:
            if os.environ.get("GUIDE_AUTO_MIGRATE") == "1":
                from guide.stores.migrate import run_migrations

                applied = await asyncio.to_thread(
                    run_migrations
                )  # 스키마 자동 적용(락 안전)
                log.info("guide migrations applied: %s", applied or "(none)")
            from guide.warmup import warmup_guide

            await asyncio.to_thread(warmup_guide)  # blocking 모델 로드 → 워커 스레드
            rt.ready = True
            log.info("guide warmup complete")
        except Exception:
            log.exception("guide warmup failed")

    app.state._warm_task = asyncio.create_task(_warm())  # 백그라운드 → 서버 즉시 기동
    yield
    # 종료: draining 은 SIGTERM 에서 set. in-flight 는 uvicorn graceful-shutdown 이 마무리.


app = FastAPI(lifespan=lifespan)

# CORS — 브라우저가 /guide-asset·/image presigned 리다이렉트를 직접 열람. 출처는 env(CORS_ORIGINS).
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from guide._security import cors_origins  # noqa: E402

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
