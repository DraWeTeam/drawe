"""주제(track) 에스컬레이션 사다리 — _pipeline 과 평가(axis_eval) 가 공유.

  ① 사용자가 track 명시 → 그대로 (VLM 0, 레이턴시 0)
  ② track 없음 + CLIP 확신(person_p<LOW=풍경 / >HIGH=인물) → CLIP 그대로
  ③ track 없음 + CLIP 애매([LOW,HIGH]) → 그때만 Gemini 주제 분류 1회

CLIP 은 스케치/선화에 약해 person_p 가 0.4~0.6 중립으로 수렴한다(손 클로즈업·옅은 풍경 등).
그 구간에서만 VLM 으로 보강하고, 확신 구간은 비용 0으로 CLIP 을 믿는다.

반환: (effective_track, extra_terms)
  - effective_track: resolve_profile 에 넘길 track('landscape' 등) 또는 None(=CLIP/figure-auto).
  - extra_terms: 강한 주제 증거로 surface 할 축(예: 손 → {'hand_structure'}). diagnose 의 user_terms 에 합친다.
"""

import os

from guide._trace import trace

# 임계는 golden-set 점수가 아니라 prom 분포의 자연 갭에서 확정(20장 실측):
#   풍경 군집 ≤0.03 → 0.12 사이 큰 갭 → _LOW=0.10(이 아래만 '확신: 풍경')
#   인물 군집 ≥0.65, 0.60→0.65 갭 → _HIGH=0.63(이 위만 '확신: 인물')
#   사이(0.10~0.63)는 애매대역 → VLM. 손은 인물/비인물 축에 안 맞아 0.26~0.78로 흩어짐 →
#   넓은 애매대역이 손 대부분을 VLM 손-판정으로 보냄(단 prom 0.78짜리 극단 단축손은 잔존 한계).
_LOW = 0.10  # 이 아래면 CLIP 확신: 풍경
_HIGH = 0.63  # 이 위면 CLIP 확신: 인물 (사이는 애매대역 → VLM)


def sketch_features(pil) -> dict:
    """선화 판정 후보 지표(결정적, cv2+numpy). '판정'이 아니라 '측정'이다 — 임계는 실데이터로 정한다.

    구분 직관: line art → mid↓·edge↑·entropy↓ / 사진 → mid↑·entropy↑ / 플랫 채색 → edge↓.
    의존성은 이미 있는 것만 사용(opencv-python-headless, numpy). cv2 실패해도 numpy 지표는 남는다.
    """
    import numpy as np

    a = np.asarray(pil.convert("L"))  # 0..255 uint8
    g = a.astype(float) / 255.0
    mid = float(((g > 0.2) & (g < 0.8)).mean())  # 중간톤 비율(선화면 ≈0)
    ink = float((g < 0.5).mean())  # 잉크(어두운) 비율
    hist = np.bincount(a.reshape(-1), minlength=256).astype(float)
    p = hist / max(hist.sum(), 1.0)
    nz = p[p > 0]
    entropy = float(-(nz * np.log2(nz)).sum())  # 톤 정보량(선화면 낮음)
    try:
        import cv2

        edges = cv2.Canny(a, 80, 160)
        edge = float((edges > 0).mean())  # 윤곽선 픽셀 비율
    except Exception:
        edge = -1.0
    return {
        "mid": round(mid, 3),
        "edge": round(edge, 3),
        "entropy": round(entropy, 2),
        "ink": round(ink, 3),
        "std": round(float(g.std()), 3),
    }


def _looks_like_sketch(pil) -> bool:
    """선화 게이트 — CLIP 신뢰 보류 판단용. mid(중간톤 비율)+entropy 두 지표 AND 로 판정.

    임계는 추측이 아니라 실측 분포로 확정함: 손 선화 mid≈0.06·entropy≈2.0 ↔ 사진/채색 mid≥0.55·
    entropy≥6.7. edge·std 는 셋을 못 가려 제외(실데이터 확인). 후보 지표는 [trace:sketch] 로 계속
    노출되니, 새 샘플로 재튜닝하려면 그 분포를 보고 아래 임계만 조정한다.
    """
    if pil is None:
        return False
    try:
        feats = sketch_features(pil)
        trace("sketch", **feats)
        # 임계: 실측 분포로 확정(선화 mid≈0.06/entropy≈2.0 ↔ 사진·채색 mid≥0.55/entropy≥6.7).
        #   두 지표 AND → 단일 지표 노이즈에 안 흔들림. edge·std 는 분리력 없어 제외(실측 확인).
        return feats["mid"] < 0.20 and feats["entropy"] < 4.0
    except Exception:
        return False


def _detect_face(pil):
    """얼굴 초상 검출 — observe_face 관찰을 검출로 재사용(FaceLandmarker 가 드로잉·측면에 약해 VLM 로).
    초상이고 관찰 신뢰가 있으면 True. FACE_VLM off·키없음·전신·불확실이면 False → figure-auto 폴백.
    결과는 캐시되어 diagnose._vlm_face_signal 이 같은 관찰을 재사용(추가 호출 없음)."""
    try:
        from guide.ml.vision import observe_face

        o = observe_face(pil)
    except Exception as e:
        print(f"[subject] 얼굴 검출 실패(figure-auto 폴백): {type(e).__name__}: {e}")
        return False
    return bool(o and o.get("is_portrait") and o.get("confidence") in ("관찰", "관찰(약)"))


def resolve_subject(scene, pil, track=None):
    if track:  # ① 명시 track → 그대로. 단 hand track 은 auto 경로(아래 subj=="hand")와 동일하게
        #   hand_structure 를 의도항으로 surface 한다 — 안 그러면 사용자가 '손' track 을 직접 고를 때
        #   auto 보다 손 피드백이 나빠진다(track-aware 평가에서 확인된 비대칭).
        return track, ({"hand_structure"} if track == "hand" else set())
    prom = float(
        (scene or {}).get("subject", {}).get("person", {}).get("prominence", 0.0)
    )
    sketch = _looks_like_sketch(pil)  # 선화면 CLIP 확신을 신뢰하지 않는다(아래 분기)
    if (
        (prom < _LOW or prom > _HIGH) and not sketch
    ):  # ③ CLIP 확신 + 선화 아님 → CLIP 그대로(track None → resolve_profile 결정)
        # 인물 쪽 확신(prom 높음)이면 얼굴 초상인지 VLM 으로 검출 → face track. subject VLM 은 여기서
        #   스킵되므로(확신대역) 얼굴 경로는 observe_face 가 검출 겸 측정을 맡는다(결과 캐시 공유).
        if prom > _HIGH and _detect_face(pil):
            trace("subject", prom=round(prom, 2), band="confident", sketch=False,
                  vlm="face", subj="face", track="face")
            return "face", {"facial_proportion"}
        trace("subject", prom=round(prom, 2), band="confident", sketch=False,
              vlm="skipped", subj=None, track=None)
        return None, set()
    # ② 애매대역 OR 선화 → Gemini 1회(게이트 off·키 없음·실패면 None → CLIP 폴백)
    try:
        from guide.ml.vision import classify_subject

        subj = classify_subject(pil)
    except Exception:
        subj = None
    # [경계0] 라우팅: VLM 게이트가 켜졌나(vlm) + 분류기가 뭐라 답했나(subj) + 선화라 강제됐나(sketch).
    #   이 한 줄이 'env 미반영(off)' / '실패·미매핑(on+None)' / '오분류(on+figure)' / '정상(hand)'를 가른다.
    _vlm = "on" if os.environ.get("SUBJECT_VLM", "0").strip().lower() in (
        "1", "true", "yes"
    ) else "off"
    _band = "ambiguous" if (_LOW <= prom <= _HIGH) else "confident_sketch"
    trace("subject", prom=round(prom, 2), band=_band, sketch=sketch, vlm=_vlm, subj=subj)
    if subj in ("landscape", "still_life"):
        return "landscape", set()  # 풍경/정물 → landscape track(대기원근·지평선 게이팅)
    if subj == "hand":
        # 손 → 전용 hand track + hand_structure 를 의도 축으로 surface(user_terms 경로 → POSE_DEPENDENT
        #   게이트 우회·리드 승격). track="hand" 라서 eligible/growth 가 손 커리큘럼(전신 축 제외)로 굳는다.
        return "hand", {"hand_structure"}
    if subj == "face":
        # 얼굴 → 전용 face track + facial_proportion 을 의도 축으로 surface(observe_face 가 신호 주입).
        return "face", {"facial_proportion"}
    # figure/None → CLIP 폴백(track None → person_p 로 figure-auto)
    return None, set()
