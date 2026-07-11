"""test_llm_metrics.py — 가이드 LLM(Grok/xAI) 호출 latency histogram 계약 회귀.

로컬엔 AMP/Alloy 스택이 없으므로(로컬 한계) OTLP export 대신 InMemoryMetricReader 로
guide._metrics 의 LLM Histogram 등록·명시 버킷(상단=complete_json timeout)·라벨(step/outcome)·
측정 방어를 검증한다. VLM·이미지생성 histogram 과는 별개 metric·별개 버킷임을 함께 확인.

실행: cd fastapi && python -m pytest tests/test_llm_metrics.py -q
"""

from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from guide import _metrics
from guide._metrics import LLM_LATENCY_BUCKETS, observe_llm


def _points(reader):
    """(attributes-frozenset -> data_point) 로 drawe_llm_latency histogram 포인트를 모은다."""
    out = {}
    md = reader.get_metrics_data()
    for rm in md.resource_metrics:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                if m.name != "drawe_llm_latency":
                    continue
                assert m.unit == "s"
                for dp in m.data.data_points:
                    out[frozenset(dp.attributes.items())] = dp
    return out


def test_llm_buckets_distinct_and_up_to_timeout():
    # 상단 90s = complete_json timeout. VLM·이미지생성 버킷과 다른 별개 시리즈.
    assert LLM_LATENCY_BUCKETS[-1] == 90
    assert LLM_LATENCY_BUCKETS != _metrics.VLM_LATENCY_BUCKETS
    assert LLM_LATENCY_BUCKETS != _metrics.IMAGE_GEN_LATENCY_BUCKETS


def test_step_labels_and_increment():
    reader = InMemoryMetricReader()
    _metrics.reset_llm_for_test(reader)

    # 13s(coach 성공) → (8,13] 버킷, 90s(plan 에러=timeout) → (55,90] 버킷.
    observe_llm(13.0, step="coach", outcome="success")
    observe_llm(90.0, step="plan", outcome="error")

    pts = _points(reader)
    coach = pts[frozenset({("step", "coach"), ("outcome", "success")})]
    plan = pts[frozenset({("step", "plan"), ("outcome", "error")})]

    # 명시 버킷이 LLM 범위(.5~90s)로 지정됐는지 — 기본 버킷이면 5~30s 구간 P95 를 못 가른다.
    assert tuple(coach.explicit_bounds) == LLM_LATENCY_BUCKETS
    assert tuple(plan.explicit_bounds) == LLM_LATENCY_BUCKETS

    # 관측이 정확한 버킷을 증가시키는지(누적 count/합).
    assert coach.count == 1 and coach.sum == 13.0
    assert plan.count == 1 and plan.sum == 90.0


def test_observe_never_raises():
    # 계측 실패는 절대 호출부(가이드 생성)를 깨지 않는다 — 잘못된 입력에도 조용히 방어.
    _metrics.reset_llm_for_test(InMemoryMetricReader())
    observe_llm(float("nan"), step="coach", outcome="success")  # 예외 없이 통과해야
