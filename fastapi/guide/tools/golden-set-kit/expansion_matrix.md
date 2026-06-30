# 골든셋 AI 생성 확장 — 설계 매트릭스 (주문서)

영역 2~5(체형·관절·무게중심·손)를 측정 가능하게 만드는 데이터셋 확장 설계. **측정 먼저, 설계부터** —
이 문서가 프롬프트 생성의 *주문서*다(자유 생성 아님, 빈 칸을 메운다). 2026-06-30 설계.

## 성공 기준 (이걸로 받는다 — 정확도 % 아님)
칸당 2~4장이라 **통계적 유의성은 못 준다.** 목표는 정밀 비율이 아니라:
> 영역 2~5가 **① 발화는 되나(over-abstain 아님)** + **② 정상 대조군에 over-fire는 0인가** — 의 *정성 게이트*.

정밀 비율은 나중에 실사용/더 큰 셋에서. 칸당 2장이면 한 장 틀려도 50%라 정밀 측정으로 읽지 말 것.

## 현재 영역 2~5 커버리지 (측정으로 깐 빈칸)
| 영역 | 현재 보유 | 빈 곳 |
|---|---|---|
| 2 체형 | **0장** | 비어있음 + **축 자체 없음**(observe_body_shape 미빌드) |
| 3 관절 | 0장 전용 | joint_articulation 축은 있으나 *primary인 이미지 0* |
| 4 무게중심 | figure_003(불안정 1)·figure_004(dynamic) | 결함 1, **정상 대조군 0** |
| 5 손 | hand_003(긴)·hand_004(단축 애매)·001/002/005(혼합) | clean **정상 대조군 0**, 단축은 애매 1뿐 |

→ **공통 빈칸 = over-fire 정상 대조군이 전 영역 0** (figure_001·005로 over-fire 잡던 그 자리). 현재 figure는
매끈한 해부도·만화풍이라 *낙관 편향*(쉬운 입력) — 실사용 손그림 분포를 안 비춤.

## 매트릭스
정상 칸 = **침묵해야 하는 그림**(abstain 가드 측정용). 결함 = 발화 대상.

| 영역 | 칸 | 종류 | 신규 | 상태 |
|---|---|---|:--:|---|
| **5 손** | 단축(어색하게 짧음) | 결함 | 3 | 즉시 |
| | 긴 손가락 | 결함 | 2 | 즉시 |
| | 짧은 손가락 | 결함 | 2 | 즉시 (긴/짧은 = 반대결함 → **분리 칸**) |
| | 정상 손 | 대조 | 4 | 즉시 (2 clean + 2 현실적-정상) |
| **4 무게중심** | 불안정(한발·쓰러질듯) | 결함 | 2 | 즉시 |
| | 뻣뻣(부자연 직립·정적) | 결함 | 3 | 즉시 |
| | 정상 안정/콘트라포스토 | 대조 | 4 | 즉시 (2 clean + 2 현실적) |
| **3 관절** | 팔꿈치 위치·각도 틀림 | 결함 | 2 | 즉시 |
| | 무릎 위치·각도 틀림 | 결함 | 2 | 즉시 |
| | 정상 관절 | 대조 | 3 | 즉시 (2 clean + 1 현실적) |
| **2 체형** | 역삼각형/모래시계/마른/통통 | 결함 | 8 | **생성 보류** (프롬프트만) |
| | 평균·중립 | 대조 | 4 | **생성 보류** (2 clean + 2 현실적) |

**즉시 생성(영역 5·4·3) = 27장** → 활성 셋 20→47. **영역 2(12장)는 축 빌드 직전 생성** — 지금 만들면
축이 한참 뒤라 매트릭스/라벨 기준 흔들릴 때 낭비. 손·관절·무게중심으로 워크플로우 검증 *후* 같은 절차로.

## 스타일 규칙 (전 칸)
각 칸 N장을 **선화 / 플랫컬러 / 러프 연필스케치**로 쪼개고 **5~8등신** 섞기. **사진풍·3D 렌더 금지**
(실사용=손그림 분포). 단일 인물·여백 배경·텍스트 없음(라우팅 깨끗하게).

### ⚠ AI 생성의 역설 (예산 함의)
AI는 *우리가 재려는 바로 그것*(손·관절·해부)에 가장 약하다 — "의도한 단축" ↔ "AI 실수로 만든 기괴한 손"이
섞인다. → 영역 5·3은 **적합성 게이트 reject율 높음, 목표의 2~3배 생성**해야 채워짐. 수율 낮음을 예산에 반영.

### ⚠ '정상'의 함정 (도메인 갭의 정상 쪽)
AI에 "정상"을 시키면 *너무 완벽한 교과서 그림*을 뽑는다. 실사용 정상은 *약간 어설프지만 결함은 아닌* 그림.
정상 대조군이 전부 "완벽한 AI 정상"이면 "완벽→침묵"은 배워도 "거칠지만 정상→침묵"은 못 배워 → 실사용
거친 정상에 over-fire. 그래서 각 정상 칸에 **현실적-정상**("naturally drawn, slightly imperfect but
within normal range, casual amateur sketch") 변주를 일부 섞는다.

## 3겹 프로세스 (생성 후)
1. **생성** — 외부 이미지 모델(Gemini/ChatGPT)에 아래 프롬프트. 칸당 목표의 2~3배 뽑아 reject 흡수.
2. **1겹 적합성 게이트 (프롬프트 알고)** — "예쁨" 아니라 *의도한 결함/정상이 실제로 보이나 + 스타일이
   실사용에 맞나*. 안 맞으면 폐기·재생성.
3. **2겹 블라인드 라벨 (프롬프트 잊고)** — 게이트 통과분을 **프롬프트를 모르는 컨텍스트**가 ground truth
   라벨(이미지만 보고). 운영: 생성 의도를 *모르는 fresh agent*에 이미지만 주고 라벨 → 프롬프트 앵커링 차단.
   불일치(짧게 만들려 했는데 정상으로 나옴)면 2겹 라벨대로 재분류 또는 폐기. **프롬프트를 라벨로 베끼지 않기.**

## 운영 — 저장·승격·추적 (블라인드 벽의 물리적 구현)
- **격리 구역 `images/_staging/`** — 검증 안 된 생성 이미지는 여기로(파일명에 칸 표시 OK, 예 `area5_foreshorten_01.png`).
  `images/`가 gitignored라 staging도 자동 무시 = reject 이미지가 본 셋·매니페스트를 오염 안 시킴. 파일명에 의도가
  박혀도 2겹 라벨러(이미지만 받는 fresh agent)는 그 이름을 못 본다 → 벽 유지.
- **승격(게이트+라벨 통과분만)** — 정식명(`hand_006_...`)으로 `images/` 이동 → 해시를 `golden_images.sha256`에
  **추가**(tracked 매니페스트가 "어느 바이트가 골든셋"의 단일 진실원) → `labels.json`에 ground truth 라벨
  추가. 본 셋은 항상 "게이트+라벨 통과"만 유지.
- **메타데이터(4단계, 라벨과 분리)** — `expansion_meta.json`(키=파일명): `{ source:"ai_gen",
  model, prompt_cell, gen_intent, style }`. 생성 의도가 `labels.json`에 안 새게 분리.
  **현재 Gemini 단일**(ChatGPT는 한도) → `model:"gemini"` 정직 기록. 잃는 건 "모델 간 비교"(어느 칸이
  AI 일반 한계인지 vs Gemini 특유 약점인지)뿐 — 지금 단계엔 불필요(목표=칸 채우기지 생성 파이프라인 구축 아님).
  나중에 ChatGPT 섞으면 그때 `model:"gpt"`로 기록돼 비교가 살아남. → "AI셋 vs 실사용" 도메인 갭 추적.

## ★ 파일럿 기대치 (영역 5 — 이걸로 받는다)
영역 5는 두 겹 게이트를 **처음 돌리는 자리** = 워크플로우 자체의 파일럿. 그래서 1차 산출물은 "손 카드 정확도"가
아니라 **워크플로우 수율** 셋이다:
- **생성 배수** — 목표 대비 몇 배 뽑아야 칸이 찼나.
- **1겹 reject율** — AI 손이 얼마나 못 쓸 만한가.
- **2겹 일치율** — 의도 ↔ 블라인드 라벨이 얼마나 어긋나나.

이 셋이 **영역 3·4·2의 예산**을 정한다(손 reject 80%면 관절도 비슷 → 생성량 그만큼).
**2겹 일치율 낮음 = 실패 아니라 발견** — "AI가 그 칸(예: 단축손)을 못 만든다"는 데이터다. 그러면 대안(다른 모델·
직접 그리기·그 칸 포기)을 정하지, 프롬프트를 골든 통과에 맞춰 깎지 않는다(= overfit의 데이터 버전 금지).
어긋나면 어긋난 대로 기록하고 "AI로 안 됨"으로 정직하게 닫는 것도 결과다(figure_002 "설계된 손실"과 같은 정신).
→ 영역 5 종료 보고 = "손 카드 됐다"보다 **"워크플로우가 이런 수율로 돈다"** 가 먼저.

---

## 프롬프트 목록
공통 접미사: `, hand-drawn, plain white background, single subject, no text, NOT photorealistic, NOT 3D render`.
N장은 style ∈ {clean line art, flat anime color, rough pencil sketch} + 등신 5~8 변주.

### 영역 5 — 손 (즉시)
- **단축**(결함×3): `A single human hand reaching toward the viewer, forearm and fingers strongly foreshortened so they look compressed and short`
- **긴 손가락**(결함×2): `A single hand with noticeably elongated, thin fingers — clearly too long relative to the palm`
- **짧은 손가락**(결함×2): `A single hand with unusually short, stubby fingers — clearly too short relative to the palm`
- **정상**(대조×4): clean×2 `A single naturally proportioned, correctly drawn relaxed human hand, no distortion`
  · 현실적×2 `A single human hand, naturally proportioned and within normal range, but with slightly uneven amateur linework (a casual sketch, not a defect)`

### 영역 4 — 무게중심 (즉시)
- **불안정**(결함×2): `Full-body character standing on one leg with weight clearly off-center, looking about to tip over, unbalanced stance`
- **뻣뻣**(결함×3): `Full-body character standing rigidly at attention, perfectly straight and stiff, no weight shift, wooden lifeless posture`
- **정상**(대조×4): clean×2 `Full-body character in a relaxed natural standing pose, believable weight on both feet, slight contrapposto, well balanced`
  · 현실적×2 `Full-body character in a casual balanced standing pose within normal range, drawn loosely like an amateur sketch (slightly awkward, not a posture defect)`

### 영역 3 — 관절 (즉시)
- **팔꿈치**(결함×2): `Full-body character whose elbow is bent at an unnatural angle, anatomically wrong arm articulation`
- **무릎**(결함×2): `Full-body character whose knee bends the wrong way or is misplaced, awkward leg articulation`
- **정상**(대조×3): clean×2 `Full-body character with natural, correctly articulated elbows and knees in a casual pose`
  · 현실적×1 `Full-body character with natural correctly-bent joints within normal range, drawn loosely like an amateur sketch`

### 영역 2 — 체형 (생성 보류, 축 빌드 직전)
- **역삼각형**(×2): `Full-body character with a clear inverted-triangle build: broad shoulders, narrow waist and hips`
- **모래시계**(×2): `Full-body character with an hourglass silhouette: balanced shoulders and hips, defined narrow waist`
- **마른**(×2): `Full-body character with a very slim, thin, lean build`
- **통통**(×2): `Full-body character with a rounded, heavier, plump build`
- **중립**(대조×4): clean×2 `Full-body character with an average, unremarkable build, neutral silhouette`
  · 현실적×2 `Full-body character of average build within normal range, drawn loosely like an amateur sketch`

## 파일럿 결과 — 영역 5 단축 (2026-06-30, Gemini/Imagen-4.0)
**수율: 생성 10 → 1겹 6 → 2겹(anatomy) 4 승격 = 40%.** 목표 3 확보에 ~2.5x 생성 필요(영역3 관절도 비슷 예상).
- **스타일이 수율을 가름:** 선화(line art) 0/4 — Imagen이 "line art hand"를 평면 정면손으로 뽑음. **연필스케치·
  플랫컬러 + "reaching/dramatic toward camera"** 프롬프트만 단축 성공 → 다른 칸도 이 결로.
- **2겹이 1겹을 조임(시스템 가치 실증):** 프롬프트에 프라이밍된 내 1겹이 통과시킨 해부 깨짐 2장(혹 같은 손목·
  손가락 모호)을 **블라인드 라벨러가 anatomy_ok=false로 잡음** → 1겹 기준에 "anatomy not broken" 추가 필요.
- **의도↔블라인드 일치율 100%**(foreshorten 속성) — AI가 단축을 "전혀 못 만듦"은 아니나 스타일 의존+해부 부작용.
- **회귀 0, 통합 성공:** 명확 auto 11/15→14/18(신규 clear hand 3장 hand_structure O), 기존 행 무변.
- **정직한 한계:** 신규의 O는 "hand 라우팅 됨"이지 아직 "**foreshortening 관찰됨**"의 증명 아님(hand_structure는
  손 클로즈업 기본 발화). observe_hand가 단축을 실제 surface하나는 영역5 ladder의 다음 single-change.

## finger-proportion(긴/짧은) = CLOSED (2026-06-30, 측정 후 정직한 닫힘)
**결론: 현재 도구로 깨끗이 측정 불가.** 세 경로 다 측정으로 시도해 다 벽 — figure_002보다 강한 닫힘(재론 불가).
1. **VLM 3분류(길다/보통/짧다)** → over-fire: 정상 손 가운데손가락 ≈ 손바닥이라 *경계가 정상값에 걸쳐*
   VLM이 normal을 "길다"로 오발화(N=5: hand_015 4/5). 단축(categorical)은 5/5 깨끗했던 것과 대조 — 길이는 continuous.
2. **CV finger/palm 비율 long-vs-normal** → 겹침(long_min 0.554 < normal_max 0.649). `palm_width`가 **손가락
   벌림에 오염**(활짝 편 normal=palm_width↑=비율↓). 결정성·스타일 윤곽은 ✅(det=0, 연필 포함 추출).
3. **CV short-detector(이진)** → 특이도·민감도는 통과했으나 **단축 손 3/4가 ★SHORT 오발화**. **"짧은 손가락"과
   "단축된 손가락"이 기하학적으로 구분 불가**(둘 다 비율↓), self-gate(손가락수)는 단축 못 거름, VLM foreshorten은
   chubby short를 오인 → 깨끗한 게이트 없음.

→ **영역5는 단축(foreshortening, 5/5 안정)으로만.** 긴/짧은 테스트베드 이미지(hand_010·012·018·019·020 등)는
golden셋에 유지(미래 deterministic 측정 재시도 또는 ladder 카드 정적 교습용). 도구 `cv_fp_probe.py`(scratchpad):
결정성+스타일 윤곽 견고 입증 → **단축과 혼동 안 되는** 손 수치(손가락 개수·엄지 각도)엔 재활용 가능.

## 작업 순서
영역 5(손, 깨끗한 발화 갭·observe_hand 안정) → **이게 두 겹 게이트 워크플로우의 파일럿** → 그 수율·reject율·
라벨 일치율을 보고 영역 3·4 → 영역 2(축 빌드와 함께). track_aware_eval 자동 회귀가 확장 셋에서 돌면
영역 2~5를 single-change로 하나씩(영역5=ladder, 3·4=observe_pose 발화 재실측 선행, 2=새 축 빌드).
