"""guide/_metrics.py — 가이드 VLM(Bedrock Claude Haiku / Gemini) 지연 계측.

배경(중요):
  이 서비스는 prometheus_client(/metrics 스크랩) 가 *아니라* OTEL auto-instrumentation
  (`opentelemetry-instrument uvicorn guide.app:app`)을 쓴다. 앱 메트릭은 OTLP 로
  Alloy(observability ns) 로 push → otelcol.exporter.prometheus → AMP RemoteWrite 로 이미 흐른다
  (configmap: OTEL_METRICS_EXPORTER=otlp, OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy...:4317).
  따라서 별도 /metrics 노출·Alloy scrape 없이 이 파이프라인에 histogram 하나만 얹으면 AMP 에 도달한다.

  ⚠️ VLM 은 수초~수십초라 OTEL 기본 버킷(0,5,10,25,…초)으로는 1~8초 구간 P95 를 못 가른다.
  버킷은 explicit 하게 지정해야 한다. 그런데 배포 OTEL(api 1.27/1.29) 의
  Meter.create_histogram 에는 explicit_bucket_boundaries_advisory 인자가 없다
  → 버킷을 주려면 View(ExplicitBucketHistogramAggregation) 가 필요하다. auto-instrumentation 의
  전역 MeterProvider 는 생성 후 View 주입이 불가하므로, 여기서 *전용* MeterProvider 를
  하나 세워(같은 OTLP 엔드포인트로 export) VLM histogram 만 담당한다. auto 전역 provider(HTTP/런타임
  메트릭)와 공존하며, resource(service.name=fastapi-guide) 를 동일 env 에서 읽어 같은 series 라벨을 받는다.

계약:
  - 계측 실패는 절대 VLM 호출/가이드 생성을 깨지 않는다(전 경로 방어, 관측만·예외는 그대로 전파).
  - 라벨은 저카디널리티(model, outcome)만. request_id 등 고유값 금지.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager

log = logging.getLogger("drawe-fastapi.guide.metrics")

# VLM 요청 지연 버킷(초). 상단 60s 가 BEDROCK_TIMEOUT(기본 60s)+재시도 상한을 덮어
# +Inf 쏠림(P95 왜곡)을 막는다. 1~8초 구간을 촘촘히 둬 P50/P95 를 가른다.
VLM_LATENCY_BUCKETS = (0.5, 1, 2, 3, 5, 8, 13, 21, 34, 60)

# 계측 이름. OTLP→Prometheus 변환 시 unit(s) 접미가 붙어 최종 series 는
# drawe_vlm_latency_seconds{_bucket,_sum,_count} 가 된다(채팅 대시보드 명명과 정합).
_INSTRUMENT_NAME = "drawe_vlm_latency"

_hist = None
_provider = None
_init_tried = False


def _build_view():
    from opentelemetry.sdk.metrics.view import (
        ExplicitBucketHistogramAggregation,
        View,
    )

    return View(
        instrument_name=_INSTRUMENT_NAME,
        aggregation=ExplicitBucketHistogramAggregation(VLM_LATENCY_BUCKETS),
    )


def _make_histogram(reader):
    """주어진 MetricReader 로 전용 MeterProvider+Histogram 을 구성해 반환.
    reader 를 주입받으므로 테스트는 InMemoryMetricReader 로 동일 View 를 검증할 수 있다."""
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.resources import Resource

    provider = MeterProvider(
        # OTEL_SERVICE_NAME/OTEL_RESOURCE_ATTRIBUTES(env) 반영 → service.name=fastapi-guide.
        # auto 전역 provider 와 같은 resource → AMP 에서 동일 job/service 라벨.
        resource=Resource.create(),
        metric_readers=[reader],
        views=[_build_view()],
    )
    meter = provider.get_meter("drawe.guide.vlm")
    hist = meter.create_histogram(
        _INSTRUMENT_NAME,
        unit="s",
        description="가이드 VLM(Bedrock Claude Haiku / Gemini) 요청 지연(초)",
    )
    return provider, hist


def _default_reader():
    """운영 기본 reader — 같은 OTLP(gRPC) 엔드포인트로 주기 export.
    OTLPMetricExporter 는 OTEL_EXPORTER_OTLP_ENDPOINT/HEADERS 를 env 에서 읽는다(auto 와 동일)."""
    from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import (
        OTLPMetricExporter,
    )
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader

    return PeriodicExportingMetricReader(OTLPMetricExporter())


def _get_hist():
    """지연·1회 초기화. 실패하면 None 을 캐시해 이후 조용히 no-op(가이드는 정상)."""
    global _hist, _provider, _init_tried
    if _hist is not None:
        return _hist
    if _init_tried:
        return None
    _init_tried = True
    try:
        _provider, _hist = _make_histogram(_default_reader())
    except Exception:  # OTEL 미가용/엔드포인트 오류 등 — 계측만 끄고 서비스는 그대로.
        log.warning(
            "VLM latency 계측 초기화 실패 — 계측 비활성(가이드는 정상)", exc_info=True
        )
        _hist = None
    return _hist


def observe_vlm(seconds: float, *, model: str, outcome: str) -> None:
    """단일 VLM 요청 지연(초)을 기록. 어떤 예외도 삼켜 호출부를 깨지 않는다."""
    h = _get_hist()
    if h is None:
        return
    try:
        h.record(max(0.0, float(seconds)), {"model": model, "outcome": outcome})
    except Exception:
        log.debug("VLM latency record 실패(무시)", exc_info=True)


@contextmanager
def measure_vlm(model: str):
    """VLM 호출을 감싸 지연을 잰다. 정상 반환=success, 예외=error 로 라벨 후 예외는 그대로 전파.
    time.monotonic() 사용(월클럭 점프에 안전). 관측은 finally 에서만."""
    t0 = time.monotonic()
    outcome = "success"
    try:
        yield
    except BaseException:
        outcome = "error"
        raise
    finally:
        observe_vlm(time.monotonic() - t0, model=model, outcome=outcome)


def reset_for_test(reader):
    """테스트 전용: 주어진 reader(InMemoryMetricReader)로 histogram 을 재구성해 반환."""
    global _hist, _provider, _init_tried
    _provider, _hist = _make_histogram(reader)
    _init_tried = True
    return _hist


# ── 레퍼런스 이미지 생성(diffusion) 지연 계측 — VLM 과 *별개* histogram ─────────────
# 생성(Bedrock Stable Image Core 등)은 diffusion 이라 관찰(VLM) 대비 훨씬 느리다
# (수초 vs 수십초). VLM 버킷(.5~60s)을 그대로 쓰면 20~60s 상단이 뭉개져 P95 를 못 가른다.
# → 상단을 높인 *전용* 버킷 + 전용 metric 이름을 쓴다(대시보드/알림도 분리).
# 상단 120s 는 BEDROCK_TIMEOUT(기본 60s) × 재시도(max_attempts=2) 최악치 및 AI_GEN_TIMEOUT
# 여유를 덮어 +Inf 쏠림(P95 왜곡)을 막는다. 실제 상한이 바뀌면 여기 상단만 조정.
IMAGE_GEN_LATENCY_BUCKETS = (1, 2, 3, 5, 8, 13, 21, 34, 55, 90, 120)

# OTLP→Prometheus 변환 시 unit(s) 접미가 붙어 최종 series 는
# drawe_image_gen_latency_seconds{_bucket,_sum,_count}. VLM(drawe_vlm_latency_seconds)과 구분.
_IMAGE_GEN_INSTRUMENT_NAME = "drawe_image_gen_latency"

_img_hist = None
_img_provider = None
_img_init_tried = False


def _build_image_gen_view():
    from opentelemetry.sdk.metrics.view import (
        ExplicitBucketHistogramAggregation,
        View,
    )

    return View(
        instrument_name=_IMAGE_GEN_INSTRUMENT_NAME,
        aggregation=ExplicitBucketHistogramAggregation(IMAGE_GEN_LATENCY_BUCKETS),
    )


def _make_image_gen_histogram(reader):
    """VLM 과 동일 구조의 전용 MeterProvider+Histogram(생성 전용 View/버킷).
    reader 주입 → 테스트는 InMemoryMetricReader 로 동일 View 검증."""
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.resources import Resource

    provider = MeterProvider(
        resource=Resource.create(),
        metric_readers=[reader],
        views=[_build_image_gen_view()],
    )
    meter = provider.get_meter("drawe.guide.imagegen")
    hist = meter.create_histogram(
        _IMAGE_GEN_INSTRUMENT_NAME,
        unit="s",
        description="레퍼런스 이미지 생성(Bedrock Stable Image / Gemini / Bria) 지연(초)",
    )
    return provider, hist


def _get_image_gen_hist():
    """지연·1회 초기화. 실패하면 None 캐시 → 이후 조용히 no-op(생성은 정상)."""
    global _img_hist, _img_provider, _img_init_tried
    if _img_hist is not None:
        return _img_hist
    if _img_init_tried:
        return None
    _img_init_tried = True
    try:
        _img_provider, _img_hist = _make_image_gen_histogram(_default_reader())
    except Exception:  # OTEL 미가용/엔드포인트 오류 등 — 계측만 끄고 생성은 그대로.
        log.warning(
            "이미지 생성 latency 계측 초기화 실패 — 계측 비활성(생성은 정상)",
            exc_info=True,
        )
        _img_hist = None
    return _img_hist


def observe_image_gen(seconds: float, *, provider: str, outcome: str) -> None:
    """단일 이미지 생성 지연(초)을 기록. 어떤 예외도 삼켜 호출부를 깨지 않는다."""
    h = _get_image_gen_hist()
    if h is None:
        return
    try:
        h.record(max(0.0, float(seconds)), {"provider": provider, "outcome": outcome})
    except Exception:
        log.debug("이미지 생성 latency record 실패(무시)", exc_info=True)


@contextmanager
def measure_image_gen(provider: str):
    """이미지 생성 호출을 감싸 지연을 잰다. 정상 반환=success, 예외=error 로 라벨 후 예외는
    그대로 전파(계측 실패가 생성 실패로 이어지지 않게). time.monotonic() 사용."""
    t0 = time.monotonic()
    outcome = "success"
    try:
        yield
    except BaseException:
        outcome = "error"
        raise
    finally:
        observe_image_gen(time.monotonic() - t0, provider=provider, outcome=outcome)


def reset_image_gen_for_test(reader):
    """테스트 전용: 주어진 reader 로 이미지 생성 histogram 을 재구성해 반환."""
    global _img_hist, _img_provider, _img_init_tried
    _img_provider, _img_hist = _make_image_gen_histogram(reader)
    _img_init_tried = True
    return _img_hist
