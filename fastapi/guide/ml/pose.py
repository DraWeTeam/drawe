"""포즈 키포인트 추출 — ViTPose(transformers VitPoseForPoseEstimation, COCO-17).

BlazePose(mediapipe)가 드로잉/선화 전신에 검출 실패(골든 실측 7/12, 특히 chibi 0/2·realistic
001·004 미검출)해 ViTPose 로 교체. ViTPose 는 top-down 이라 인물 bbox 가 필요한데, 가이드 업로드는
'단일 인물이 프레임을 지배'하므로 full-frame bbox 로 pose-stage 만 돌린다(별도 인물검출기 불필요 →
HumanArt 검출기 라이선스/추가 의존성 회피). 출력 COCO-17 → 33-slot BlazePose 순서로 재배치(어댑터)
→ diagnose/overlay 의 BlazePose-33 인덱스 로직은 그대로 동작(다운스트림 0 수정).

라이선스: usyd-community/vitpose-base = COCO-only 학습 + 가중치 Apache-2.0(상업 클린).
  (RTMPose body7 은 AI-Challenger(비상업) 포함, DWPose 는 UBody 비상업 → 둘 다 off-the-shelf 부적격.)

전신 게이트(★over-fire 가드): full-frame bbox 는 손/얼굴/풍경에도 *무조건* 17점을 뱉는다(BlazePose 의
  no_person 자기게이팅이 없음). 그대로 두면 비인물에 전신 스켈레톤이 measured 로 잡혀 track 게이팅의
  measured∩POSE_DEPENDENT 예외를 타고 weight_balance/action_line 이 샌다. 그래서 전신 구조관절
  (어깨·골반·무릎·발목 8점) 중앙 점수 medStruct >= _GATE 일 때만 검출로 인정 — 골든 분포 갭
  [비인물 max 0.60 | 인물 min 0.70]에서 0.65 로 잡음(골든 점수 fit 아님, 자연 갭). 미만이면 skipped.

어떤 단계든 실패하면(import·모델·추론) 예외 삼키고 skipped 폴백 → API 항상 기동(기존 정책 동일).
"""

import logging

import numpy as np

log = logging.getLogger("drawe-fastapi.guide.ml.pose")

# COCO-17 → 33-slot BlazePose 인덱스(어댑터). diagnose/overlay 가 참조하는 13관절만 채운다.
#   coco: 0 nose / 5,6 어깨 / 7,8 팔꿈치 / 9,10 손목 / 11,12 골반 / 13,14 무릎 / 15,16 발목
#   blaze: nose0 / 어깨11,12 / 팔꿈치13,14 / 손목15,16 / 골반23,24 / 무릎25,26 / 발목27,28
_COCO2BLAZE = {
    0: 0,
    5: 11,
    6: 12,
    7: 13,
    8: 14,
    9: 15,
    10: 16,
    11: 23,
    12: 24,
    13: 25,
    14: 26,
    15: 27,
    16: 28,
}
_CORE = [
    0,
    11,
    12,
    13,
    14,
    15,
    16,
    23,
    24,
    25,
    26,
    27,
    28,
]  # 채워지는 13관절(mean_visibility 분모)
_STRUCT = [11, 12, 23, 24, 25, 26, 27, 28]  # 전신 존재 판정(몸통+다리)
_GATE = 0.65  # medStruct 게이트 — 골든 분포 갭(비인물 max 0.60 / 인물 min 0.70)에서. 데이터로 재튜닝 대상.
_MODEL = "usyd-community/vitpose-base"

_proc = None
_model = None
_ready = None  # None=미시도, True=가능, False=불가


def _get():
    global _proc, _model, _ready
    if _ready is not None:
        return _ready
    try:
        import torch  # noqa: F401  (지연 import — 서비스 기동 시 무거운 로드 회피)
        from transformers import AutoProcessor, VitPoseForPoseEstimation

        _proc = AutoProcessor.from_pretrained(_MODEL)
        _model = VitPoseForPoseEstimation.from_pretrained(_MODEL)
        _model.eval()
        _ready = True
        log.info("[pose] ViTPose(vitpose-base) 준비 완료")
    except Exception as e:
        log.warning(
            f"[pose] ViTPose 초기화 실패 → 포즈 비활성: {type(e).__name__}: {e}"
        )
        _proc, _model, _ready = None, None, False
    return _ready


def extract(scene, pil):
    if not _get():
        return {"status": "skipped", "reason": "pose_unavailable"}
    try:
        import torch

        rgb = np.asarray(pil.convert("RGB"))
        H, W = rgb.shape[:2]
        boxes = [
            [[0.0, 0.0, float(W), float(H)]]
        ]  # full-frame(단일 인물이 프레임 지배 가정)
        inputs = _proc(rgb, boxes=boxes, return_tensors="pt")
        with torch.no_grad():
            outputs = _model(**inputs)
        pp = _proc.post_process_pose_estimation(outputs, boxes=boxes)
    except Exception as e:
        log.warning(f"[pose] ViTPose 추론 실패 → skipped: {type(e).__name__}: {e}")
        return {"status": "skipped", "reason": "pose_error"}
    if not pp or not pp[0]:
        return {"status": "skipped", "reason": "no_person_detected"}
    person = pp[0][0]
    kxy = np.asarray(person["keypoints"])  # (17,2) 원본 픽셀 좌표
    kc = np.asarray(person["scores"])  # (17,)

    def v(i):
        return float(kc[i])

    arr = [(0.0, 0.0, 0.0)] * 33
    for ci, bi in _COCO2BLAZE.items():
        arr[bi] = (float(kxy[ci][0]) / W, float(kxy[ci][1]) / H, v(ci))

    # 전신 게이트: 구조관절(몸통+다리) 중앙 점수. 손/얼굴/풍경(부분/비인물)은 다리·몸통 점수가
    #   낮아 여기서 걸러진다 = BlazePose no_person 자기게이팅의 대체. (분포 갭 0.65)
    med_struct = float(np.median([arr[i][2] for i in _STRUCT]))
    if med_struct < _GATE:
        return {
            "status": "skipped",
            "reason": "no_full_figure",
            "med_struct": med_struct,
        }

    mean_vis = float(
        np.mean([arr[i][2] for i in _CORE])
    )  # 코어 13관절 평균(미사용 슬롯 제외)
    return {"status": "ok", "mean_visibility": mean_vis, "keypoints": arr}
