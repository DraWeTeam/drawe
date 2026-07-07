# 5. AI 파이프라인 설계 ⭐

DraWe의 **핵심·차별점**은 **한 끗 가이드(코칭 에이전트 파이프라인)** 다 — 사용자가 그린 그림을 **관찰 → 진단 → 코칭**한다. 나머지 두 축은 **레퍼런스 보드(키워드 검색)** 와 **채팅(레퍼런스 추천·AI 이미지 생성)** 이며, 세 축은 저장소·경로가 분리된다: **가이드=Qdrant / 보드·채팅 검색=Pinecone / 이미지 생성=Bedrock**.
본 섹션은 세 축을 분리해 각 단계의 **설계 의도와 근거**를 기술한다. (흐름 그림은 [README](./README.md), 단계 시퀀스는 [sequenceDiagram](./sequenceDiagram.md), 상태 전이는 [stateMachineDiagram](./stateMachineDiagram.md) 참고)

| 축 | 정체 | 저장소 | 절 |
|---|---|---|---|
| **A. 한 끗 가이드** ⭐ | 코칭 에이전트 파이프라인(그림 관찰→코칭) | Qdrant | §5.1 |
| **B. 레퍼런스 보드** | 순수 키워드 의미검색 | Pinecone | §5.2 |
| **C. 채팅** | 의도 분류 → 레퍼런스 추천·AI 생성 | Pinecone·Bedrock | §5.3 |

## 5.1 축 A — 한 끗 가이드 (코칭 에이전트 파이프라인) ⭐ 정본·차별점

단순 레퍼런스 검색을 넘어, 내가 그린 그림을 진단·코칭하는 것이 DraWe의 1번 차별점이다. 백엔드(`GuideService`)는 오케스트레이션(권한·멱등·영속)만 하고, 실제 관찰·코칭은 `fastapi-guide`(Qdrant·`drawe_guide` RDS)가 수행한다.

```
업로드 → 관찰(포즈 키포인트 mediapipe + VLM Bedrock Claude)
      → 진단 → 우선순위 결정(관찰 신호 기반 결정 로직)
      → 검색(Qdrant taxonomy 정적 축 질의 + 무드 soft boost + exclude 재탐색)
      → 코칭(Grok) → 피드백 루프(🔄 reroll → 소진 시 AI 생성 backfill → QC 통과분 코퍼스 편입)
```

- **역할 분리(설계 핵심)**: **VLM = 관찰**(무엇이 보이는지 신호화) · **결정 로직 = 우선순위 판단**(무엇을 먼저 고칠지) · **LLM(Grok) = 표현**(코칭 문장). 관찰·판단·표현을 분리해 환각과 비용을 통제한다 — 판단을 LLM에 맡기지 않는 것이 요점.
- **관찰**: mediapipe 포즈/손 키포인트 게이트 + VLM(Bedrock Claude Haiku) 관찰 신호(taxonomy·what_to_observe). OpenCLIP ViT-L/14(768-dim) 임베딩으로 검색 벡터도 함께 뽑는다.
- **진단·결정**: 관찰 신호를 근거로 약점을 진단하고, **결정 로직**이 우선 교정 축을 정한다(LLM 판단 아님).
- **검색**: 결정된 축으로 Qdrant 가이드 코퍼스에 **taxonomy 정적 축 질의** — 온보딩 무드가 있으면 **soft boost("결이 맞는 것 우선")**, 이미 보여준 참조는 **exclude 재탐색**으로 제외.
- **코칭**: Grok(grok-4.3)이 한 끗 포인트·추천 연습을 표현(provider 추상화는 §5.3.5와 동일).
- **피드백 루프**: 🔄 **reroll**(노출분 제외 재탐색, LLM 0콜) → 소진 시 **AI 생성 backfill**(Bedrock) → **QC 통과분만 코퍼스 편입**. 좋아요=반응 저장(정렬·유지용, **검색 랭킹 무반영**) / 싫어요=다음 검색 제외(+3회 누적 시 생성 유도 모달) / **취향 결**=온보딩 무드 persona 교집합 표시.
- **성장 중심 맞춤**: `coach` 모드만 `growth`(user_id 단위 진척) 이력으로 저장해 약점·이력을 반영, 개인화한다.

## 5.2 축 B — 레퍼런스 보드 (키워드 검색)

보드는 **순수 키워드 검색**이다 — 의도 분류·라우팅은 쓰지 않는다(그건 채팅 한정 §5.3).

- **키워드 추출**: Komoran 형태소 → **미술 사용자 사전(ArtTerms) KO→EN 매핑** → 사전 미스율이 임계(>30%)면 **Grok LLM 폴백**(상세 §5.3.3, 채팅과 공유).
- **의미 검색**: CLIP 임베딩(fastapi-embed) → **Pinecone** 의미검색으로 결이 가까운 레퍼런스를 되돌린다.
- **피드백**: 좋아요=반응 저장(정렬·유지용, **검색 랭킹 무반영**) / 싫어요=**다음 검색에서 제외**(+3회 누적 시 생성 유도 모달).

## 5.3 축 C — 채팅 파이프라인 (레퍼런스 추천 · AI 생성)

채팅은 **의도 분류로 라우팅**되는 파이프라인이다(보드·가이드와 구분). COMPOSE(LLM) 응답 조립은 이 축 한정이다.

```
메시지 → ① 의도 분류 → ② 키워드 추출 → ③ CLIP 임베딩 → ④ Pinecone 검색
       → ⑤ MySQL 메타 + IDF re-rank → ⑥ COMPOSE(LLM) + 무결성 → 응답
```
- 검색이 필요한 의도(NEW_SEARCH)만 ②~⑤를 타고, KEEP/FOLLOWUP 등은 직전 레퍼런스를 재사용(⑥로 직행). GENERATE는 AI 이미지 생성(Bedrock)으로 분기한다.

### 5.3.1 의도 분류 (Intent)
- **Rule 우선 + LLM 분류**: 명확한 패턴은 RulePreRouter가 빠르게 처리, 모호하면 Grok이 분류.
- **설계 근거**: 매 요청을 LLM에 보내면 비용·지연이 크므로, 규칙으로 거를 수 있는 건 거른다.
- 의도별로 후속 단계(검색/유지/합성/생성/거절)가 갈린다.

### 5.3.2 전체 의도 라우팅 (IntentRouting.ROUTING)
12개 의도 → 실행할 StepExecutor 시퀀스의 정적 매핑. **흐름 그림([README](./README.md))은 대표 분기(검색 vs 재사용)만 보이고, 전체 의도는 아래 표가 정본이다.**

| 의도(IntentCode) | 라우팅(Step 시퀀스) | 설명 |
|---|---|---|
| **NEW_SEARCH** | EXTRACT_KEYWORDS → SEARCH → COMPOSE | 신규 레퍼런스 검색(②~⑥ 전체) |
| **KEEP** | COMPOSE | 직전 레퍼런스 유지·이어보기(재사용) |
| **FOLLOWUP** | COMPOSE | 직전 답변 부연(검색 없음, 베타 빈도 1위 29%) |
| **COMPARE** | COMPOSE | 맥락 내 레퍼런스 비교(`[1]` vs `[2]`) |
| **SKIP** | COMPOSE | 추천 없이 대화 진행 |
| **COMPOSITION** | COMPOSE | 구도 조언(검색 없이 조언) |
| **LIGHTING** | COMPOSE | 명암·조명 조언 |
| **COLOR** | COMPOSE | 색감 조언 |
| **TECHNIQUE** | COMPOSE | 기법 조언 |
| **OUT_OF_DOMAIN** | COMPOSE | 도메인 밖 요청 — 정중한 안내/거절 |
| **GENERATE** | TRANSLATE → GENERATE_IMAGE | AI 이미지 생성(Bedrock Stability), COMPOSE 미종착 |
| **SELF_CRITIQUE** | CRITIQUE_UPLOAD → COMPOSE | 업로드 그림 자기비평 |

- **검색 그룹**: NEW_SEARCH 1개만 ②~⑤(키워드·임베딩·검색·re-rank)를 탄다.
- **재사용/조언 그룹(COMPOSE 종착)**: KEEP·FOLLOWUP·COMPARE·SKIP·COMPOSITION·LIGHTING·COLOR·TECHNIQUE·OUT_OF_DOMAIN — 검색 없이 직전 레퍼런스(Redis)·맥락만으로 ⑥ 합성.
- **별도 흐름**: GENERATE(이미지 생성), SELF_CRITIQUE(업로드 비평)는 검색 파이프라인과 다른 트랙.
- **Live 게이트**: live는 **COMPOSE 종착 의도만 허용**(§5.3.9) — GENERATE처럼 COMPOSE로 끝나지 않는 의도는 부팅 검증에서 막힌다.
- LEARNING_PATH(학습 경로)는 베타 빈도가 낮아 **보류**(가장 가까운 기존 코드로 매핑).

### 5.3.3 키워드 추출
> 축 B(레퍼런스 보드)와 공유하는 단계다.
- **문제**: 한국어 요청은 검색 신호로 바로 못 씀. 범용 형태소 분석기는 "수채화풍" 같은 복합어를 쪼개거나 "그려줘" 같은 요청 동사를 키워드로 섞는다.
- **해결**: Komoran 형태소 → **미술 사용자 사전(ArtTerms) KO→EN 매핑** → 사전 미스율이 임계(>30%)면 **Grok LLM 폴백**.
- **설계 포인트**: 사전 93→247개 확장으로 도메인 정확도↑, 요청 동사는 불용어로 제거, 복합어는 사전으로 보존.

### 5.3.4 검색 + 하이브리드 re-rank
- **흐름**: CLIP 임베딩(fastapi-embed) → Pinecone top-K **overfetch**(예: 40) → MySQL 메타 결합 → **IDF re-rank** → topK 트림.
- **re-rank 공식**:
  ```
  score = CLIP_cosine + min(CAP, SCALE × Σ IDF(matched query tokens))
  IDF(t) = ln((N+1) / (df+1))
  ```
- **설계 근거**: CLIP 단독은 의미는 비슷하나 결이 다른 결과(예: 커피↔네온 수영장)를 섞는다. 태그 overlap을 IDF로 가중해 변별력을 보강하되, **CAP으로 상한을 둬 CLIP 점수를 덮지 않게** 튜닝(원본 CLIP 점수는 가드 판정에 그대로 사용).
- **점수 가드**: `avg < 0.2 AND max < 0.24`면 무관 결과로 보고 차단 → 빈 결과 시 "AI 생성 제안".
- **태그 신호 출처**: Unsplash=rawTags(키워드)·ai_description(캡션), AI 이미지=prompt(문장). IDF 색인은 부팅 시 코퍼스로 1회 빌드(백그라운드).

### 5.3.5 COMPOSE + 무결성
- **입력**: 페르소나(SYSTEM) + 레퍼런스 컨텍스트(태그·**ai_description 캡션**) + (멀티모달 시 이미지).
- **출력**: 스키마 강제 LLM 호출 → 파싱 → **무결성 검사**로 `{1..refs.size}` 밖의 환각 인용 제거.
- **provider 추상화**: prod=Grok(grok-4.3) / PAID=Claude, Gemini=dev 폴백. 롤백 env: 코칭 provider env(compose)·VLM_BACKEND(관찰).

### 5.3.6 ai_description — 할루시네이션 완화
- **문제**: LLM은 픽셀을 못 보고 태그(라벨)만 받아, 없는 디테일을 지어낸다(예: 꽃 없는 이미지를 "꽃과 함께"로 설명).
- **해결**: 이미지의 **실제 내용을 묘사한 캡션(ai_description)** 을 컬럼으로 보강해 설명의 근거로 우선 주입 + "태그/캡션에 없는 디테일 지어내지 마" 가드.
- **데이터**: Unsplash 네이티브 AI 캡션을 `images.ai_description`으로 보강. AI 이미지는 prompt가 동일 역할(null-safe 폴백).

### 5.3.7 핀 / 레퍼런스 LLM 주입
- **핀 분리**: 고정 이미지는 검색 `[N]`과 충돌하지 않게 **"고정 N" 네임스페이스**로 분리 주입(프론트 그리드 슬롯 번호와 일치).
- **핀 제외 + 재부여**: 검색 결과에 핀 이미지가 섞이면 `[N]`에서 제외하고 남은 refs를 **1..N으로 재부여**(무결성 검사의 1..size 범위와 정합).

### 5.3.8 멀티턴 단기메모리
- **Redis**(`session:{userId}:{projectId}`)에 직전 턴 레퍼런스(previousReferences) 보관 → KEEP/FOLLOWUP에서 재사용.
- **초기화**: DB 메시지 + Redis 단기메모리를 **둘 다** 비워야 이전 맥락이 완전히 사라진다.

### 5.3.9 Legacy ↔ Live 게이트
- **전환 스위치**: `workflow.compose.live-intents`(env `WORKFLOW_COMPOSE_LIVE_INTENTS`)에 나열된 의도만 워크플로(live)로 처리, 나머지는 legacy 직접 합성.
- **부팅 검증**: live 의도는 **COMPOSE로 끝나는 것만 허용**(GENERATE 등 불가) — 위반 시 기동 실패.
- **설계 근거**: 레거시→live 전면 전환의 위험을 낮추기 위해 **의도 단위로 점진 전환**, shadow 메트릭으로 검증 후 확대.
