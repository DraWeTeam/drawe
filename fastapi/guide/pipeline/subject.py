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

_LOW = 0.35  # 이 아래면 CLIP 확신: 풍경
_HIGH = 0.60  # 이 위면 CLIP 확신: 인물 (사이는 애매대역 → VLM)


def resolve_subject(scene, pil, track=None):
    if track:  # ① 명시 track → 그대로
        return track, set()
    prom = float(
        (scene or {}).get("subject", {}).get("person", {}).get("prominence", 0.0)
    )
    if (
        prom < _LOW or prom > _HIGH
    ):  # ③ CLIP 확신 → CLIP 그대로(track None → resolve_profile 결정)
        return None, set()
    # ② 애매대역 → Gemini 1회(게이트 off·키 없음·실패면 None → CLIP 폴백)
    try:
        from guide.ml.vision import classify_subject

        subj = classify_subject(pil)
    except Exception:
        subj = None
    if subj in ("landscape", "still_life"):
        return "landscape", set()  # 풍경/정물 → landscape track(대기원근·지평선 게이팅)
    if subj == "hand":
        # 손 → figure-auto(track None) + hand_structure 를 의도 축으로 surface.
        #   user_terms 와 같은 경로(POSE_DEPENDENT 가드 우회·게이트 통과·리드 승격)를 탄다.
        return None, {"hand_structure"}
    # figure/face/None → CLIP 폴백(track None → person_p 로 figure-auto)
    return None, set()
