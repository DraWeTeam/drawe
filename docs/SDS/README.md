# DraWe — 시스템 설계 문서 (SDS)

> **그림 위에서 짚어주는 AI 코칭(한 끗 가이드) · 레퍼런스 탐색·생성**
> 업로드한 그림을 **관찰 → 진단 → 코칭**하는 것이 DraWe의 핵심이고, 레퍼런스 탐색(보드)과 AI 이미지 생성은 그 창작 여정을 지원한다.

이 문서는 DraWe 전체 시스템의 **개요(인덱스)** 다. 상세는 각 섹션 문서로 연결된다.

---

## 1. 한눈에 보기

| 항목 | 내용 |
|---|---|
| **무엇** | 내가 그린 그림을 **관찰→진단→코칭**(한 끗 가이드) + 자연어로 레퍼런스 탐색·AI 생성 |
| **누구** | 그림을 그리려는 사용자(초보~중급) |
| **핵심 가치** | ① 업로드 그림 코칭(관찰→진단→코칭) ② 결이 맞는 레퍼런스 탐색 ③ 맞는 레퍼런스가 없으면 AI로 즉석 생성 |
| **차별점** | 단순 이미지 검색을 넘어 — ① **한 끗 가이드**: 내가 그린 그림을 코칭하는 에이전트 파이프라인 ② **관찰의 정직성**: 측정(ViTPose·결정적 스코어러)과 관찰 가설(VLM)을 분리해 "측정한 척"을 막음 ③ **AI 이미지 생성**: 레퍼런스가 없으면 Bedrock으로 확보 |

### 주요 사용자 여정

![주요 사용자 여정](./img/user-journey.svg)

## 2. 시스템 아키텍처

![DraWe System Architecture](./img/systemArchitecture-eks.png)

- **Backend(Spring Boot)** 가 도메인 로직·인증·오케스트레이션을 담당.
- **FastAPI·embed**(CLIP ViT-L/14, 768d) → 임베딩 → **Pinecone**(보드·채팅 검색). **FastAPI·guide** → 이미지 가이드(ViTPose·**Qdrant**·`drawe_guide` RDS).
- 이미지 생성 = **AWS Bedrock**(Stability). VLM 관찰(옵트인) = prod Bedrock Claude Haiku 4.5 / dev Gemini.
- 배포: **AWS EKS** — CD가 ECR 이미지를 빌드해 overlay `newTag`를 bump하면 **ArgoCD**(automated selfHeal)가 롤아웃. 상세는 [systemArchitecture](./systemArchitecture.md).

## 3. 핵심 ① — 한 끗 가이드 (코칭 에이전트 파이프라인) ⭐

내가 그린 그림을 진단·코칭하는 것이 DraWe의 1번 차별점이다. 백엔드(`GuideService`)는 오케스트레이션(권한·멱등·영속)만 하고, 실제 파이프라인은 외부 `fastapi-guide`가 수행한다.

```
업로드 → 관찰(ViTPose 바디 키포인트 + 결정적 scene 분석)   [손 mediapipe·세부 VLM은 옵트인 가설]
      → 진단(결정적 threshold 스코어러) → 우선순위 결정(agent.decide, 결정적)
      → 검색(Qdrant 정적 축 질의 + 무드 soft boost + exclude post-filter)
      → 코칭(Grok, 순차) → 피드백 루프(🔄 reroll 0콜 → 소진 시 AI 생성 backfill → QC 5단계 게이트 코퍼스 자가치유)
```

![이미지 가이드 파이프라인](./img/guide-pipeline.svg)

- **관찰 = 측정 + 가설 분리(설계 핵심)**: 바디 키포인트는 **ViTPose**(`transformers` vitpose-base, COCO-17)가 **항상** 추출하고 결정적 scene 분석이 신호를 만든다(이게 진단 근거). 손 구조는 mediapipe(HAND_AUTO 옵트인, 기본 off), 세부 관찰(pose/hand/face/subject/style)은 VLM(prod Bedrock Claude Haiku 4.5 / dev Gemini) **가설로 옵트인**(각 `*_VLM` 게이트 기본 off, `measured=False`). "측정한 척"을 막는 게 요점(ADR 0001).
- **진단·결정**: 결정적 threshold 스코어러(`SCORERS`)가 약점 축을 발화하고, `agent.decide`(기본 결정적)가 우선 교정 축을 정한다 — LLM 판단 아님(`AGENT_LLM_SELECT` 옵트인 시에만 후보 순서 선택).
- **검색**: 결정된 축의 정적 taxonomy 질의로 **Qdrant** 가이드 코퍼스 검색. 온보딩 무드가 있으면 soft boost, 이미 보여준 참조는 exclude로 제외(post-filter).
- **코칭**: **Grok**(grok-4.3)이 한 끗 포인트를 표현. 가드레일 검증 실패 시 **순차 재시도**(최대 3콜). 병렬 아님.
- **피드백 루프**: 🔄 **reroll**(노출분 제외 재탐색, **LLM 0콜**) → 소진 시 **AI 생성 backfill**(Bedrock) → **QC 5단계 게이트 통과분만 코퍼스 편입**(`source_type='ai_example'`).
- **성장 중심 맞춤**: `coach` 모드만 `growth`(user_id 진척) 이력으로 저장해 개인화(성장 그래프 시연은 합성 이력 기반).

## 4. 핵심 ② — 레퍼런스 탐색 · 생성 ⭐

- **레퍼런스 보드(순수 키워드 검색)**: Komoran 형태소 → **미술 사용자 사전(ArtTerms) KO→EN** → 미스율 >30%면 Grok 폴백 → CLIP ViT-L/14(768d) → **Pinecone** 의미검색. **의도 라우팅 없음**. 싫어요=다음 검색 제외(+3회 누적 시 생성 유도 모달), 좋아요=반응 저장(카드 표식만, **랭킹 무영향**).
- **채팅**: 의도 분류(RulePreRouter → Grok 폴백)는 매 요청 실행. **AI 이미지 생성** = `GuideClient` → `POST /generate-image` → **Bedrock Stability**. 단, 의도 라우팅→COMPOSE 워크플로는 **현재 미가동(dormant, live-intents 빈값)** — 현행 채팅 응답은 **레거시 직접합성**이 만든다(자세히 [aiPipelineDesign §5.3](./aiPipelineDesign.md)).
- **전역 검색(SearchModal)**: 엔티티 텍스트 **MySQL LIKE**(벡터 아님) — 위 두 벡터 경로와 별개.

## 5. 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | React, Vite |
| Backend | Spring Boot, Java 17, JPA, QueryDSL, Resilience4j |
| AI 서비스 | FastAPI, **CLIP ViT-L/14(768d)**, **ViTPose**(바디 포즈)·mediapipe(손), **Grok**(코칭·키워드 폴백), **Bedrock Claude Haiku 4.5** VLM(옵트인 관찰) |
| 이미지 생성 | **AWS Bedrock Stability**(stable-image-core, prod) / Gemini(dev) |
| 벡터 스토어 | **Qdrant**(가이드 코퍼스) · **Pinecone**(보드·채팅 검색) |
| 데이터 | MySQL, Redis · Valkey, S3 |
| 인프라 | **AWS EKS**, **ArgoCD**(GitOps, selfHeal), ECR, IRSA, GitHub Actions CD |

## 6. 문서 구성 (SDS 인덱스)

| # | 섹션 | 내용 |
|---|---|---|
| 1 | [introduction](./introduction.md) | 개요·목적·범위 |
| 2 | [systemArchitecture](./systemArchitecture.md) | 컴포넌트·배포·데이터흐름 |
| 3 | [usecaseAnalysis](./usecaseAnalysis.md) | 유스케이스 |
| 4 | [userInterfacePrototype](./userInterfacePrototype.md) | UI 목업 |
| 5 | [aiPipelineDesign](./aiPipelineDesign.md) | AI 파이프라인 설계 근거 ⭐ |
| 6 | [classDiagram](./classDiagram.md) | 도메인별 클래스 다이어그램 |
| 7 | [sequenceDiagram](./sequenceDiagram.md) | 도메인별 시퀀스 다이어그램 |
| 8 | [stateMachineDiagram](./stateMachineDiagram.md) | 전체·도메인 상태 머신 |
| 9 | [dataDesign](./dataDesign.md) | MySQL · Redis · Pinecone · Qdrant · S3 |
| 10 | [implementationRequirements](./implementationRequirements.md) | 기술스택·배포·복원력·보안 |
| 11 | [glossary](./glossary.md) | 용어 정의 |
| 12 | [references](./references.md) | 참고 자료 |

## 7. 도메인 모듈 (백엔드)

`auth` · `project` · `image` · `search`(보드) · `llm`(chat·intent·workflow) · `guide`(코칭 에이전트) · `gallery` · `onboarding` · `admin` · `analytics`
