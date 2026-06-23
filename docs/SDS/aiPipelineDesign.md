# 6. AI 파이프라인 설계 ⭐

DraWe의 핵심은 **한국어 자유 요청 → 정확한 레퍼런스 추천·미술 조언**을 만드는 AI 파이프라인이다.
본 섹션은 각 단계의 **설계 의도와 근거**를 기술한다. (흐름 그림은 [README](./README.md), 단계 시퀀스는 [sequenceDiagram](./sequenceDiagram.md), 상태 전이는 [stateMachineDiagram](./stateMachineDiagram.md) 참고)

## 6.1 전체 단계
```
메시지 → ① 의도 분류 → ② 키워드 추출 → ③ CLIP 임베딩 → ④ Pinecone 검색
       → ⑤ MySQL 메타 + IDF re-rank → ⑥ COMPOSE(LLM) + 무결성 → 응답
```
- 검색이 필요한 의도(NEW_SEARCH)만 ②~⑤를 타고, KEEP/FOLLOWUP 등은 직전 레퍼런스를 재사용(⑥로 직행).

## 6.2 의도 분류 (Intent)
- **Rule 우선 + LLM 분류**: 명확한 패턴은 RulePreRouter가 빠르게 처리, 모호하면 Grok이 분류.
- **설계 근거**: 매 요청을 LLM에 보내면 비용·지연이 크므로, 규칙으로 거를 수 있는 건 거른다.
- 의도별로 후속 단계(검색/유지/합성/생성/거절)가 갈린다.

### 6.2.1 전체 의도 라우팅 (IntentRouting.ROUTING)
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
| **GENERATE** | TRANSLATE → GENERATE_IMAGE | AI 이미지 생성(Bria), COMPOSE 미종착 |
| **SELF_CRITIQUE** | CRITIQUE_UPLOAD → COMPOSE | 업로드 그림 자기비평 |

- **검색 그룹**: NEW_SEARCH 1개만 ②~⑤(키워드·임베딩·검색·re-rank)를 탄다.
- **재사용/조언 그룹(COMPOSE 종착)**: KEEP·FOLLOWUP·COMPARE·SKIP·COMPOSITION·LIGHTING·COLOR·TECHNIQUE·OUT_OF_DOMAIN — 검색 없이 직전 레퍼런스(Redis)·맥락만으로 ⑥ 합성.
- **별도 흐름**: GENERATE(이미지 생성), SELF_CRITIQUE(업로드 비평)는 검색 파이프라인과 다른 트랙.
- **Live 게이트**: live는 **COMPOSE 종착 의도만 허용**(§6.9) — GENERATE처럼 COMPOSE로 끝나지 않는 의도는 부팅 검증에서 막힌다.
- LEARNING_PATH(학습 경로)는 베타 빈도가 낮아 **보류**(가장 가까운 기존 코드로 매핑).

## 6.3 키워드 추출
- **문제**: 한국어 요청은 검색 신호로 바로 못 씀. 범용 형태소 분석기는 "수채화풍" 같은 복합어를 쪼개거나 "그려줘" 같은 요청 동사를 키워드로 섞는다.
- **해결**: Komoran 형태소 → **미술 사용자 사전(ArtTerms) KO→EN 매핑** → 사전 미스율이 임계(>30%)면 **Grok LLM 폴백**.
- **설계 포인트**: 사전 93→247개 확장으로 도메인 정확도↑, 요청 동사는 불용어로 제거, 복합어는 사전으로 보존.

## 6.4 검색 + 하이브리드 re-rank
- **흐름**: CLIP 임베딩(fastapi-embed) → Pinecone top-K **overfetch**(예: 40) → MySQL 메타 결합 → **IDF re-rank** → topK 트림.
- **re-rank 공식**:
  ```
  score = CLIP_cosine + min(CAP, SCALE × Σ IDF(matched query tokens))
  IDF(t) = ln((N+1) / (df+1))
  ```
- **설계 근거**: CLIP 단독은 의미는 비슷하나 결이 다른 결과(예: 커피↔네온 수영장)를 섞는다. 태그 overlap을 IDF로 가중해 변별력을 보강하되, **CAP으로 상한을 둬 CLIP 점수를 덮지 않게** 튜닝(원본 CLIP 점수는 가드 판정에 그대로 사용).
- **점수 가드**: `avg < 0.2 AND max < 0.24`면 무관 결과로 보고 차단 → 빈 결과 시 "AI 생성 제안".
- **태그 신호 출처**: Unsplash=rawTags(키워드)·ai_description(캡션), AI 이미지=prompt(문장). IDF 색인은 부팅 시 코퍼스로 1회 빌드(백그라운드).

## 6.5 COMPOSE + 무결성
- **입력**: 페르소나(SYSTEM) + 레퍼런스 컨텍스트(태그·**ai_description 캡션**) + (멀티모달 시 이미지).
- **출력**: 스키마 강제 LLM 호출 → 파싱 → **무결성 검사**로 `{1..refs.size}` 밖의 환각 인용 제거.
- **provider 추상화**: Gemini·Grok·Claude를 교체 가능.

## 6.6 ai_description — 할루시네이션 완화
- **문제**: LLM은 픽셀을 못 보고 태그(라벨)만 받아, 없는 디테일을 지어낸다(예: 꽃 없는 이미지를 "꽃과 함께"로 설명).
- **해결**: 이미지의 **실제 내용을 묘사한 캡션(ai_description)** 을 컬럼으로 보강해 설명의 근거로 우선 주입 + "태그/캡션에 없는 디테일 지어내지 마" 가드.
- **데이터**: Unsplash 네이티브 AI 캡션을 `images.ai_description`으로 보강. AI 이미지는 prompt가 동일 역할(null-safe 폴백).

## 6.7 핀 / 레퍼런스 LLM 주입
- **핀 분리**: 고정 이미지는 검색 `[N]`과 충돌하지 않게 **"고정 N" 네임스페이스**로 분리 주입(프론트 그리드 슬롯 번호와 일치).
- **핀 제외 + 재부여**: 검색 결과에 핀 이미지가 섞이면 `[N]`에서 제외하고 남은 refs를 **1..N으로 재부여**(무결성 검사의 1..size 범위와 정합).

## 6.8 멀티턴 단기메모리
- **Redis**(`session:{userId}:{projectId}`)에 직전 턴 레퍼런스(previousReferences) 보관 → KEEP/FOLLOWUP에서 재사용.
- **초기화**: DB 메시지 + Redis 단기메모리를 **둘 다** 비워야 이전 맥락이 완전히 사라진다.

## 6.9 Legacy ↔ Live 게이트
- **전환 스위치**: `workflow.compose.live-intents`(env `WORKFLOW_COMPOSE_LIVE_INTENTS`)에 나열된 의도만 워크플로(live)로 처리, 나머지는 legacy 직접 합성.
- **부팅 검증**: live 의도는 **COMPOSE로 끝나는 것만 허용**(GENERATE 등 불가) — 위반 시 기동 실패.
- **설계 근거**: 레거시→live 전면 전환의 위험을 낮추기 위해 **의도 단위로 점진 전환**, shadow 메트릭으로 검증 후 확대.
