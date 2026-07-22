# 5. AI 파이프라인 설계 ⭐

DraWe의 **핵심·차별점**은 **한 끗 가이드(코칭 에이전트 파이프라인)** — 사용자가 그린 그림을 **관찰 → 진단 → 코칭**한다. 나머지 두 축은 **레퍼런스 보드(키워드 검색)** 와 **채팅(이미지 생성 · 레퍼런스 추천)** 이며, 세 축은 저장소·경로가 코드상 분리된다.

| 축 | 정체 | 저장소 | 절 |
|---|---|---|---|
| **A. 한 끗 가이드** ⭐ | 코칭 에이전트 파이프라인(그림 관찰→코칭) | Qdrant | §5.1 |
| **B. 레퍼런스 보드** | 키워드 의미검색 + AI 생성 + 피드백(의도 라우팅 없음) | Pinecone · Bedrock | §5.2 |
| **C. 채팅** | 의도 분류(LIVE) · 추천 워크플로 **미채택(retired)** | Pinecone | §5.3 |

> 검색 경로는 셋으로 분리된다: **가이드 코칭=Qdrant**(정적 축 질의), **보드·채팅 추천=Pinecone**(CLIP 의미검색), **전역 검색(SearchModal)=MySQL LIKE**(엔티티 텍스트, 벡터 아님). 본 섹션은 각 축의 실제 동작과 설계 근거를 기술한다.

## 5.1 축 A — 한 끗 가이드 (코칭 에이전트 파이프라인) ⭐ 정본·차별점

백엔드(`GuideService`)는 오케스트레이션만 하고, 실제 파이프라인은 외부 `fastapi-guide`(Qdrant·`drawe_guide` RDS)가 수행한다.

```
업로드 → normalize/upload_guard → scene(OpenCLIP analyze)
      → 관찰(ViTPose 바디 키포인트, 항상)   [손 mediapipe·세부 VLM은 옵트인 가설]
      → 진단(결정적 threshold 스코어러) → 우선순위 결정(agent.decide, 결정적)
      → 검색(Qdrant taxonomy 정적 축 질의 + 무드 soft boost + exclude post-filter)
      → 코칭(Grok, 순차 재시도) → 피드백 루프(🔄 reroll 0콜 → 소진 시 AI 생성 backfill → QC 5단계 게이트 코퍼스 자가치유)
```

- **역할 분리(설계 핵심, ADR 0001)**: **측정 = 사실**(ViTPose 키포인트 · 결정적 scene/스코어러) · **VLM = 관찰(가설)**(옵트인 · 기본 off · `measured=False`) · **결정 로직 = 우선순위 판단** · **LLM(Grok) = 표현**. 측정과 관찰(가설)을 분리해 "측정한 척"을 막고, 판단을 LLM에 맡기지 않는 것이 요점.
- **관찰**: **ViTPose**(`transformers` `VitPoseForPoseEstimation`, `usyd-community/vitpose-base`, COCO-17)가 바디 키포인트를 **모든 업로드에서 무조건** 추출한다(top-down이라 full-frame bbox로 pose만). 손 구조는 **mediapipe HandLandmarker**(`HAND_AUTO` 옵트인, 기본 off), 세부 관찰(pose/hand/face/subject/style)은 **VLM**(백엔드 기본 aistudio=Gemini / prod overlay bedrock=Claude Haiku 4.5) 가설로 **옵트인**(각 `*_VLM` 게이트 기본 off). 선화 판정은 결정적 휘도 휴리스틱(value_std<0.08).
- **진단·결정**: 결정적 threshold 스코어러(`SCORERS`, 임계는 `DX_THRESHOLDS`)가 관찰 신호로 약점 축을 발화 → confidence·growth nudge로 랭킹해 **top-3** → `agent.decide`(기본 `_deterministic`)가 리드 축을 정한다(stated → measured → focus → recurring 순). LLM 개입은 `AGENT_LLM_SELECT` 옵트인 시에만(후보 순서 선택, grounding 강제).
- **검색**: 결정된 축의 **정적 taxonomy 질의**(`reference_query`)로 **Qdrant** 검색(`vector_backend="qdrant"`). hard 필터 = commercial_ok + persona별 제외, **mood soft boost**(hard 아님)·source/persona/medium/track boost·채택 리랭크, **exclude**는 후보 post-filter(must_not 아님).
- **코칭**: **Grok**(`grok-4.3`, provider 미설정 시 DummyLLM)이 가드레일 루프로 코칭 JSON 생성 — 스키마→닫힌세계(근거 ref)→금지표현 검증, 실패 시 **순차 재시도(최대 3콜)**. 가이드 1건은 growth_context 1콜 → decide(0콜) → coach 1~3콜이 **전부 순차**(코칭 병렬 아님).
- **피드백 루프**: 🔄 **reroll**(`POST /reroll`) = 저장 sub_problem의 정적 질의 복원 + 노출분 exclude, **LLM/진단/코칭 0콜**. `is_miss`(소진/저품질) 시 AI적격 축(value/composition/light/color)만 **backfill**(생성기 prod=Bedrock Stability) → **QC 5단계 게이트**(축적격·일러스트 여부·개념 CLIP·축교차 CLIP·해부 pose/hands) 통과분만 corpus 편입(`source_type='ai_example'`).
- **성장**: `coach` 모드만 `growth`(user_id 진척) 이력으로 저장해 개인화(성장 그래프 시연은 합성 이력 기반).

## 5.2 축 B — 레퍼런스 보드 (키워드 검색 · AI 생성)

보드의 **검색은 순수 키워드 검색**이다 — 의도 분류·라우팅은 쓰지 않는다(코드상 IntentRouter/Classifier 호출·import 부재). 검색·생성·피드백을 한 보드에서 오케스트레이션한다.

- **진입·경로**: `ReferenceBoardController`(search·generate·generations·like·dislike·reaction·ack) → `ReferenceBoardService`.
- **키워드 추출**: **Komoran** 형태소(`DEFAULT_MODEL.FULL`) + user-dic → **미술 사용자 사전(ArtTerms) KO→EN CSV**(`dictionary.lookup`) → 사전 미스율 **>30%면 Grok(xAI) 폴백**.
- **의미 검색**: 쿼리 → **CLIP ViT-L/14(768d)** 임베딩(`POST /embed/text`, 전용 embed 서비스) → **Pinecone** `queryByVector`. 하이브리드 재정렬 = dense CLIP + 태그 IDF soft boost(cap 0.05). 관련성 게이트(키워드 미매칭 or max<0.18) → "결과 없음"(생성 유도).
- **AI 생성(보드 통합)**: 원하는 레퍼런스가 없으면 보드에서 직접 생성 — `POST /reference-board/generate` → `ReferenceBoardService.generateReference` → `imageGenerationService.generate`(→ GuideClient → **Bedrock Stability**) → source=AI Image 저장·인덱싱. **생성 대화(프롬프트→이미지)** 는 저장돼 보드 재진입 시 복원(`GET /generations`).
- **피드백**: **싫어요** = 저장 + 세션 카운터 + 다음 검색에서 image id 제외, **3회 누적 → 생성 유도 모달**. **좋아요** = 반응 저장(카드 표식만), **아카이브·랭킹 무영향**.

## 5.3 축 C — 채팅 (AI 이미지 생성 · 추천)

**의도 분류는 매 요청 실행**(`RulePreRouter.route` 결정적 → 미스 시 Grok 폴백)되지만, 그 아래 **라우팅→COMPOSE 워크플로는 미채택(retired)** 이다 — 제품 방향이 무드보드 검색 + 한 끗 가이드로 정리되면서 COMPOSE 워크플로는 채택되지 않았다. prod overlay 의 `WORKFLOW_COMPOSE_LIVE_INTENTS` 를 비워 코드 기본값(빈 집합, `liveIntents = EnumSet.noneOf`)으로 dormant 화했고(애플리케이션 코드는 불변), **현행 채팅 응답은 레거시 직접합성**이 만든다.

- **실제 사용자 액션**(`ChatLlmService.chat`): NEW_SEARCH · KEEP/SKIP · FOLLOWUP/COMPARE · GENERATE_NOW · PIN/REFERENCE_SIMILAR · OUT_OF_DOMAIN · SELF_CRITIQUE.
- **AI 이미지 생성 엔진**: `ImageGenerationService.generate` → `GuideClient.generateImage`(`POST /generate-image`) → **prod Bedrock Stability**(stable-image-core). **현행 유저 surface는 레퍼런스 보드**(§5.2, `POST /reference-board/generate`)이며, 챗 `GENERATE_NOW`(게이트 이전 short-circuit)도 같은 엔진을 호출한다. PIN/REFERENCE_SIMILAR도 게이트 이전 short-circuit.
- **워크플로(폐기된 설계, historical)**: `IntentRouting.ROUTING`은 의도→StepExecutor 시퀀스의 정적 매핑(NEW_SEARCH=`[EXTRACT_KEYWORDS,SEARCH,COMPOSE]`, 대부분 `[COMPOSE]`, GENERATE=`[TRANSLATE,GENERATE_IMAGE]`). 이는 채택되지 않은 설계 스펙으로, live 게이트가 켜졌을 때만 도는 경로다(prod 미채택). 부팅 검증이 COMPOSE 미종착 의도(GENERATE 등)의 live 진입을 막는다(fail-fast).
- **유령(DEAD)**: `WorkflowService`·`StepExecutor` 계열(`GenerateImageExecutor` 등)은 **미연결 골격** — 게이트가 켜지지 않는 한 실행되지 않는다. shadow 경로(Komoran 워크플로 병렬 1회)는 비교·메트릭 수집만 하며 실응답에 영향 없다.

## 5.4 설계 결정 하이라이트

코드·ADR에 근거가 남은 주요 기술 결정. (caveat 있는 항목은 한계를 함께 표기 — 근거 없는 수치는 싣지 않는다.)

| 결정 | 이유 | 근거 |
|---|---|---|
| **BlazePose(mediapipe) → ViTPose 포즈 교체** | mediapipe는 드로잉/선화 전신에 취약 — 골든 **7/12**(chibi 0/2) 검출 → ViTPose로 **12/12**. 라이선스도 `vitpose-base`=Apache-2.0 상업 클린(RTMPose/DWPose는 비상업 데이터 기각) | `ml/pose.py:1-16`; `diagnose.py:725-726` |
| **측정=사실 / 관찰=가설 분리** | 검출기가 0입력인 케이스는 임계 튜닝 불가 → VLM은 관찰자로만 두고 `measured=False`로 surface해 "측정한 척"을 막음 | ADR 0001 (`fastapi/docs/adr/0001`) |
| **abstain / over-fire 게이팅** | agree-or-abstain·2-run·positive-only로 confabulation 억제("약한 정답 > 확신 오답"). 관찰하지 못한 것은 말하지 않는다 | ADR 0003; `diagnose.py:722-736` |
| **하이브리드 키워드 검색(보드)** | 순수 CLIP의 결-다른 혼입을 태그 IDF 소프트 부스트(cap 0.05)로 **순서만** 보정, raw CLIP 점수 보존(CLIP 지배 방지) | `SearchService.java:147-207`; `TagIdfIndex.java:17-26` |
| **reroll 서버측 재추천(LLM 0콜)** | 저장 축 정적질의 복원 + 노출분 배제(무상태). exclude=None이면 검색 byte-identical(회귀 0) | `routes.py:675`(POST /reroll) |
| **QC-게이트 코퍼스 인제스트(생성기 비종속)** | 생성 예제는 QC 5단계 통과분만 적재 → 생성기(Bedrock/Gemini/Bria) 교체해도 QC·적재 불변 | `pipeline/ai_qc.py`; `routes_ai_qc.py` |

**Caveat 명시 항목**: Grok 프롬프트 캐시(history trim) — 캐시 적중률은 마이크로벤치로 conv-id 기여를 분리할 수 없어(단일 run 노이즈) **수치는 싣지 않는다**(`backend/docs/decisions/grok-prompt-cache-history-trim.md` 자기-caveat). 정확도 방법론(ADR 0002) — 골든셋이 개발셋이라 일반화는 낙관적일 수 있음(자인).
