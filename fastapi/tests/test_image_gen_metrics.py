"""test_image_gen_metrics.py — 레퍼런스 이미지 생성 latency histogram 계약 회귀.

로컬엔 생성 provider/AMP 스택이 없으므로(로컬 한계) OTLP export 대신 InMemoryMetricReader 로
guide._metrics 의 이미지 생성 Histogram 등록·명시 버킷(생성용 상단 높임)·라벨(provider/outcome)·
측정 방어를 검증한다. VLM histogram(drawe_vlm_latency)과는 별개 metric·별개 버킷임을 함께 확인.

실행: cd fastapi && python -m pytest tests/test_image_gen_metrics.py -q
"""

from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from guide import _metrics
from guide._metrics import (
    IMAGE_GEN_LATENCY_BUCKETS,
    measure_image_gen,
    observe_image_gen,
)


def _points(reader):
    """(attributes-frozenset -> data_point) 로 drawe_image_gen_latency histogram 포인트를 모은다."""
    out = {}
    md = reader.get_metrics_data()
    for rm in md.resource_metrics:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                if m.name != "drawe_image_gen_latency":
                    continue
                assert m.unit == "s"
                for dp in m.data.data_points:
                    out[frozenset(dp.attributes.items())] = dp
    return out


def test_buckets_are_generation_scale_not_vlm():
    # 생성 버킷은 VLM(.5~60s)보다 상단이 높아야 한다(diffusion 수십초 → 120s 상단).
    assert IMAGE_GEN_LATENCY_BUCKETS[-1] == 120
    assert IMAGE_GEN_LATENCY_BUCKETS != _metrics.VLM_LATENCY_BUCKETS


def test_buckets_labels_and_increment():
    reader = InMemoryMetricReader()
    _metrics.reset_image_gen_for_test(reader)

    # 8s(성공) → (5,8] 버킷, 90s(에러) → (55,90] 버킷.
    observe_image_gen(8.0, provider="bedrock", outcome="success")
    observe_image_gen(90.0, provider="bedrock", outcome="error")

    pts = _points(reader)
    ok = pts[frozenset({("provider", "bedrock"), ("outcome", "success")})]
    err = pts[frozenset({("provider", "bedrock"), ("outcome", "error")})]

    # 명시 버킷이 생성 범위(1~120s)로 지정됐는지 — 기본/VLM 버킷이면 P95 를 못 가른다.
    assert tuple(ok.explicit_bounds) == IMAGE_GEN_LATENCY_BUCKETS
    assert tuple(err.explicit_bounds) == IMAGE_GEN_LATENCY_BUCKETS

    # 관측이 정확한 버킷을 증가시키는지(누적 count/합).
    assert ok.count == 1 and ok.sum == 8.0
    assert err.count == 1 and err.sum == 90.0
    # bounds=(1,2,3,5,8,13,21,34,55,90,120) → len 11, bucket_counts len 12.
    # 8 → index 4(≤8), 90 → index 9(≤90).
    assert ok.bucket_counts[4] == 1 and sum(ok.bucket_counts) == 1
    assert err.bucket_counts[9] == 1 and sum(err.bucket_counts) == 1


def test_measure_labels_outcome_and_propagates():
    reader = InMemoryMetricReader()
    _metrics.reset_image_gen_for_test(reader)

    with measure_image_gen("bedrock"):
        pass  # 정상 종료 → success

    raised = False
    try:
        with measure_image_gen("gemini"):
            raise RuntimeError("boom")  # 예외 → error 라벨 후 그대로 전파
    except RuntimeError:
        raised = True
    assert raised, "measure_image_gen 은 내부 예외를 삼키지 않고 전파해야 한다"

    pts = _points(reader)
    outcomes = {dict(k)["outcome"] for k in pts}
    assert outcomes == {"success", "error"}


def test_observe_never_raises_when_metric_disabled():
    # 계측 비활성(초기화 실패 시뮬레이션)이어도 호출부는 절대 깨지지 않는다.
    _metrics._img_hist = None
    _metrics._img_init_tried = True  # _get_image_gen_hist() 가 재시도 없이 None 반환
    observe_image_gen(1.23, provider="x", outcome="success")  # no raise
    with measure_image_gen("x"):
        pass  # no raise
