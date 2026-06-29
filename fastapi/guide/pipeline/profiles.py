"""track(목표·스타일) 프로파일 — 범용 엔진 위에 갈아끼우는 한 덩어리.

한 프로파일이 세 가지를 묶는다:
  (a) subproblems : 이 track에서 '켜는' 항목(게이팅). 풍경엔 포즈/해부 항목 제외.
  (b) curriculum  : 성장 순서. 인물·풍경이 다름(전역 단일 순서의 한계를 푸는 핵심).
  (c) norms       : 측정 norm. 비율 스코어러의 leg_torso 밴드 등 — 스타일마다 다름.

엔진(diagnose·roadmap)은 이 프로파일만 받아 동작이 달라진다.
상태머신(new→steady)·recurring·tries는 track과 무관하게 공통으로 재사용된다.

명시 track이 오면 그걸 쓰고, 없으면 scene(인물 유무)으로 자동 선택한다.
존재하지 않는 track 문자열은 안전하게 auto로 떨어진다(앱 안 깨짐).

※ 풍경 전용 항목(선원근·대기원근·깊이층·지평선)이 taxonomy에 추가되어 풍경 track 이 이를 순서화한다.
  측정 가능한 둘(대기원근·지평선)은 image 신호 스코어러가 붙고, 나머지 둘은 persona/언급으로 surface.
  스타일별 레퍼런스 렌더(애니/치비 등신)는 3D 백본(MakeHuman 파라미터)에서 생성하는 오프라인 자산 과제.
"""

# 인물 track 기본 순서(구조 먼저). 전체 taxonomy를 커리큘럼으로 사용.
_FIGURE_ORDER = [
    "proportion",
    "weight_balance",
    "action_line",
    "joint_articulation",
    "foreshortening",
    "hand_structure",
    "value_structure",
    "light_direction",
    "composition_balance",
    "color_harmony",
]
# 비인물(풍경·정물): 풍경 전용 축(원근·대기원근·깊이·지평선) + 범용 축. 구조(구도·원근) 먼저 → 빛/색.
_SCENE_ORDER = [
    "composition_balance",
    "horizon_placement",
    "linear_perspective",
    "atmospheric_perspective",
    "depth_layering",
    "value_structure",
    "light_direction",
    "color_harmony",
]
# 손(클로즈업): 손에서 의미 있는 축만. 전신 축(proportion·weight_balance·action_line·joint_articulation·
#   전신 foreshortening)은 손에 안 맞아 제외 — 이게 v1 의 핵심(손을 figure 커리큘럼으로 평가하지 않음).
#   hand_structure 가 리드, 나머지는 이미지축(채색/명암 손 그림에 적용; 선화면 substrate 필터가 제외).
#   [v2 확장 자리] HAND_AUTO(HandLandmarker)가 측정 신호를 만들면 여기에 손가락 비율·손목 각도·엄지
#   위치·손바닥 구조 등 손 전용 measured 축을 끼워 넣는다(순서 = 성장 커리큘럼).
_HAND_ORDER = [
    "hand_structure",
    "value_structure",
    "light_direction",
    "composition_balance",
    "color_harmony",
]

# 단일 출처(SSOT): 커리큘럼/축 정의는 여기 한 곳. roadmap 등 다른 모듈은 이 공개 별칭을 끌어다 쓴다
# (예전엔 roadmap.py 가 _FIGURE_ORDER 를 복제해 drift 위험이 있었음 → 제거).
FIGURE_ORDER = _FIGURE_ORDER
SCENE_ORDER = _SCENE_ORDER
ALL_AXES = _FIGURE_ORDER + [
    a for a in _SCENE_ORDER if a not in _FIGURE_ORDER
]  # 순서 보존 합집합(14축)

# 포즈(전신 키포인트)에 의존하는 축. 포즈가 degraded(전신 미검출)면 측정 불가라,
# 진단·중재에서 이 축들을 '리드(이번에 딱 하나)'로 단정·승격하지 않는다(흉상·초상에 전신 비율 오발화 방지).
# 이미지 기반 축(value_structure·composition_balance·light_direction·color_harmony)은 포즈 없이도 측정된다.
POSE_DEPENDENT = {
    "proportion",
    "weight_balance",
    "foreshortening",
    "joint_articulation",
    "action_line",
    "hand_structure",
}

# norms — 비율 스코어러의 leg_torso 밴드(이 밖이면 발화). 대략값, 데이터로 재튜닝 대상.
#   밴드가 None이면 비율 자동 발화를 끈다(스타일을 모를 때 '비율 틀림' 오발화 방지 = 안전 기본값).
_NORM_REAL = {"leg_torso": (0.75, 1.7)}  # 사실체(약 7~8등신)
_NORM_ANIME = {"leg_torso": (0.9, 2.3)}  # 애니/웹툰(다리 길게)
_NORM_CHIBI = {"leg_torso": (0.4, 1.1)}  # 치비/SD(다리 짧게·머리 크게)
_NORM_OFF = {"leg_torso": None}  # 스타일 미상/비인물 → 비율 자동 발화 끔

PROFILES = {
    "realistic_figure": {
        "label": "사실체 인물",
        "subproblems": _FIGURE_ORDER,
        "curriculum": _FIGURE_ORDER,
        "norms": _NORM_REAL,
    },
    "anime_figure": {
        "label": "애니/웹툰 인물",
        "subproblems": _FIGURE_ORDER,
        "curriculum": _FIGURE_ORDER,
        "norms": _NORM_ANIME,
    },
    "chibi_figure": {
        "label": "치비/SD",
        "subproblems": _FIGURE_ORDER,
        "curriculum": _FIGURE_ORDER,
        "norms": _NORM_CHIBI,
    },
    "landscape": {
        "label": "풍경/정물",
        "subproblems": _SCENE_ORDER,
        "curriculum": _SCENE_ORDER,
        "norms": _NORM_OFF,
    },
    "hand": {
        "label": "손",
        "subproblems": _HAND_ORDER,  # 게이팅: 손 축만 켠다(전신 축 제외)
        "curriculum": _HAND_ORDER,  # 성장: 손 기준 순서 → growth 가 색·구도를 figure 에서 안 물려받음
        "norms": _NORM_OFF,  # 손엔 leg_torso 비율 무의미 → 자동발화 끔
    },
}

# 자동(track 미지정) 폴백. 인물이면 인물(자동), 아니면 풍경.
#   인물(자동)은 스타일을 모르므로 norms를 OFF로 둬 비율 오발화를 막는다(사실체 단정 금지).
_FIGURE_AUTO = {
    "label": "인물(자동)",
    "subproblems": _FIGURE_ORDER,
    "curriculum": _FIGURE_ORDER,
    "norms": _NORM_OFF,
}


# ── 스타일→norm 라우팅(인물 자동 전용) ───────────────────────────────────────────────────
#   비례 노름은 스타일마다 달라(real 7~8등신 / anime 다리길게 / chibi 머리큼), 스타일을 모르면
#   _NORM_OFF 로 비례 자동발화를 꺼야 '의도된 데포르메'를 오류로 단정하지 않는다. 그래서 인물(자동)
#   에서 스타일을 확정할 수 있을 때만 해당 norm 을 켠다 — CLIP 확신, 애매하면 VLM 1회, 그래도
#   모르면 OFF(abstain). 이 게이트가 '자신 있게 틀린 비례 조언'을 막는다.
_STYLE_LABELS = {  # CLIP zero-shot 라벨(실측에서 set A보다 분리력 좋았던 set B)
    "realistic": "a realistic anatomical figure drawing with natural proportions",
    "anime": "a stylized anime cartoon character with long legs",
    "chibi": "a cute chibi character, big head, short stubby body",
}
_STYLE_NORM = {"realistic": _NORM_REAL, "anime": _NORM_ANIME, "chibi": _NORM_CHIBI}
_STYLE_HIGH = 0.70  # CLIP 확신 임계(분포 갭 0.56↔0.83 사이). 이 아래는 VLM 에스컬레이션.


def _resolve_style(pil):
    """인물 그림의 스타일 → 'realistic'|'anime'|'chibi'|None. CLIP 확신이면 그대로, 애매하면
    VLM 1회, 그래도 미상이면 None(→ _NORM_OFF). subject 라우팅과 같은 에스컬레이션 사다리."""
    if pil is None:
        return None
    try:
        import numpy as np
        from guide._trace import trace
        from guide.ml.scene import _scores
        from guide.ml.embed import embedder

        iv = embedder.image(pil)
        sc = _scores(iv, list(_STYLE_LABELS.values()))
        keys = list(_STYLE_LABELS.keys())
        probs = [sc[p] for p in _STYLE_LABELS.values()]
        i = int(np.argmax(probs))
        top, conf = keys[i], float(probs[i])
        if conf >= _STYLE_HIGH:
            trace("style", src="clip", style=top, conf=round(conf, 2))
            return top
        # 애매 → VLM 으로 *보강*. 단 VLM 을 CLIP 위에 무조건 덮어쓰지 않는다(실측: figure_002 는
        #   CLIP anime 가 맞고 VLM 이 chibi 로 틀림 → 덮어쓰면 약한-정답을 확신-오답으로 교체).
        #   일치하면 확정, 불일치/미상이면 abstain(_NORM_OFF) — '자신 있게 틀린 비례 조언' 차단.
        from guide.ml.vision import classify_style

        vlm = classify_style(pil)
        if vlm is None:
            trace("style", src="clip_low", style=top, conf=round(conf, 2), abstain=True)
            return None
        if vlm == top:
            trace("style", src="agree", style=top, conf=round(conf, 2))
            return top
        trace("style", src="conflict", clip=top, vlm=vlm, conf=round(conf, 2), abstain=True)
        return None  # CLIP·VLM 불일치 → 미상(abstain)
    except Exception as e:
        print(f"[profiles] 스타일 분류 실패(미상 처리): {type(e).__name__}: {e}")
        return None


def resolve_profile(track=None, scene=None, pil=None):
    """명시 track 우선 → scene로 자동 → 정보 없으면 기본 레인(인물).

    'scene가 인물 없음'(풍경)과 'scene 자체가 없음'(이미지 없는 /roadmap 호출 등)을 구분한다.
    후자는 주제를 알 수 없으니 제품의 1차 레인인 인물(자동)로 둔다. 알 수 없는 track도 여기로.

    pil 이 있으면 인물(자동)에서 스타일을 확정해 비례 norm 을 켠다(없으면 _NORM_OFF 유지).
    """
    if track and track in PROFILES:
        return PROFILES[track]
    if scene is None:
        return _FIGURE_AUTO  # 정보 없음 → 기본 레인(인물)
    # 제품 1차 레인은 인물. CLIP 은 스케치/선화(색·질감 부족)에 약해 person_p 가 자주 중립(≈0.5)으로
    # 수렴하므로, '확실히 풍경'(person_p 가 충분히 낮을 때)에만 landscape 로 보낸다.
    #   비대칭 비용: 인물→풍경 오분류(지평선 가이드 등)가 풍경→인물보다 UX 손실이 크다.
    #   확정 인물은 명시 track(위) 또는 추후 face-detection 으로, 여기선 보수적 풍경 게이트만.
    prom = float(scene.get("subject", {}).get("person", {}).get("prominence", 0.0))
    if prom < 0.35:
        return PROFILES["landscape"]
    # 인물(자동): 스타일을 확정할 수 있으면 그 norm 을 켜고, 못 하면 OFF(abstain) 유지.
    style = _resolve_style(pil)
    if style:
        return {**_FIGURE_AUTO, "norms": _STYLE_NORM[style], "style": style}
    return _FIGURE_AUTO
