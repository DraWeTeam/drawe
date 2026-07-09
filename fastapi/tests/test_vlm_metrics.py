"""test_vlm_metrics.py — 가이드 VLM latency histogram 계약 회귀.

로컬엔 VLM/AMP 스택이 없으므로(로컬 한계) OTLP export 대신 InMemoryMetricReader 로
guide._metrics 의 Histogram 등록·명시 버킷·라벨(model/outcome)·측정 방어를 검증한다.

실행: cd fastapi && python -m pytest tests/test_vlm_metrics.py -q
"""

from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from guide import _metrics
from guide._metrics import VLM_LATENCY_BUCKETS, measure_vlm, observe_vlm


def _points(reader):
    """(attributes-frozenset -> data_point) 로 drawe_vlm_latency histogram 포인트를 모은다."""
    out = {}
    md = reader.get_metrics_data()
    for rm in md.resource_metrics:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                if m.name != "drawe_vlm_latency":
                    continue
                assert m.unit == "s"
                for dp in m.data.data_points:
                    out[frozenset(dp.attributes.items())] = dp
    return out


def test_buckets_labels_and_increment():
    reader = InMemoryMetricReader()
    _metrics.reset_for_test(reader)

    # 2.5s(성공) → (2,3] 버킷, 40s(에러) → (34,60] 버킷.
    observe_vlm(2.5, model="claude-haiku", outcome="success")
    observe_vlm(40.0, model="claude-haiku", outcome="error")

    pts = _points(reader)
    ok = pts[frozenset({("model", "claude-haiku"), ("outcome", "success")})]
    err = pts[frozenset({("model", "claude-haiku"), ("outcome", "error")})]

    # 명시 버킷이 VLM 범위(0.5~60s)로 지정됐는지 — 기본 OTEL 버킷이면 P95 를 못 가른다.
    assert tuple(ok.explicit_bounds) == VLM_LATENCY_BUCKETS
    assert tuple(err.explicit_bounds) == VLM_LATENCY_BUCKETS

    # 관측이 정확한 버킷을 증가시키는지(누적 count/합).
    assert ok.count == 1 and ok.sum == 2.5
    assert err.count == 1 and err.sum == 40.0
    # bucket_counts 는 len(bounds)+1. 2.5 → index 3(≤3), 40 → index 9(≤60).
    assert ok.bucket_counts[3] == 1 and sum(ok.bucket_counts) == 1
    assert err.bucket_counts[9] == 1 and sum(err.bucket_counts) == 1


def test_measure_vlm_labels_outcome_and_propagates():
    reader = InMemoryMetricReader()
    _metrics.reset_for_test(reader)

    with measure_vlm("claude-haiku"):
        pass  # 정상 종료 → success

    raised = False
    try:
        with measure_vlm("claude-haiku"):
            raise RuntimeError("boom")  # 예외 → error 라벨 후 그대로 전파
    except RuntimeError:
        raised = True
    assert raised, "measure_vlm 는 내부 예외를 삼키지 않고 전파해야 한다"

    pts = _points(reader)
    outcomes = {dict(k)["outcome"] for k in pts}
    assert outcomes == {"success", "error"}


def test_observe_never_raises_when_metric_disabled():
    # 계측 비활성(초기화 실패 시뮬레이션)이어도 호출부는 절대 깨지지 않는다.
    _metrics._hist = None
    _metrics._init_tried = True  # _get_hist() 가 재시도 없이 None 반환
    observe_vlm(1.23, model="x", outcome="success")  # no raise
    with measure_vlm("x"):
        pass  # no raise
