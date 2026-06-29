# SCRUM-112 — "[N]번이랑 유사한 사진" 레퍼런스 기반 유사검색 (설계 1-pager)

> 상태: MVP 구현 완료 · 작성일 2026-06-29 · 트랙: 검색/멀티턴
> 한 줄: 사용자가 직전 레퍼런스 **[N]번과 유사한 이미지**를 요청하면, **그 이미지 자체의 임베딩**으로 유사검색하도록 배선한다. (지금은 N이 버려지고 텍스트 키워드 추측 검색으로 빠져 엉뚱한 결과·인용 어긋남)

---

## 1. 배경 / 문제 (현상)

"[N]번이랑 유사한 사진 보여줘" 요청 시 **엉뚱한 이미지가 나오거나 인용([N])이 어긋난다.** 원인은 복합적:

1. **앵커 N이 버려짐** — `ChatLlmService` 의 의도 어댑트에서 `referencedImages = List.of()` 로 항상 비움(`ChatLlmService.java:150` 부근). `StepContext` 계약(§"[N]번 패턴 제거 → cleanedMessage + referencedImages 슬롯")이 **미구현**. → "몇 번"인지가 검색에 안 들어감.
2. **history [N] stripping** — `HistorySanitizer` 가 과거 USER/ASSISTANT 의 [N] 을 제거(`HistorySanitizer.java:56-62`). LLM 은 history 텍스트만으론 [N] 이 어떤 이미지인지 알 수 없음.
3. **NEW_SEARCH 로 분류 → 텍스트 추측 검색** — `KeywordExtractor` system prompt 가 "[N]번 같은 거"를 "직전 답변 텍스트에서 키워드 추출 → NEW_SEARCH"로 처리. 실제 [N] **이미지의 임베딩을 안 씀**(`SearchService.search` 는 텍스트→벡터).
4. **핀 제외 후 재번호 불일치** — 핀 필터 후 1-based 재부여로 사용자가 본 [N] ↔ 실제 참조가 밀릴 수 있음(`ChatLlmService` 레거시/`chatViaWorkflow`).

---

## 2. 현재 동작 (AS-IS)

```
"[1]번 유사" → KeywordExtractor(NEW_SEARCH, 직전답변 텍스트에서 키워드 추측)
            → SearchService.search(텍스트) → embedText → Pinecone
            → [1] 이미지와 무관한 "키워드 유사" 결과
```
- [1] 이미지의 시각 정보가 검색에 0% 반영.

## 3. 제안 (TO-BE)

```
"[1]번 유사" → 앵커 파싱(N=1) → previousReferences[N] → imageId → Image.sourceId
            → PineconeClient.fetchVector(sourceId)   ← (C) 이미 색인된 벡터 재사용(재임베딩 X)
            → SearchService.searchByVector(벡터, topK) → 자기 자신·핀 제외
            → [1] 이미지와 진짜 시각적으로 유사한 결과
   ※ fetch 실패/부재 시 폴백 (A): ImageDownloadService.download(bytes) → embedImage → searchByVector
```

**핵심: 새 인프라 최소.** 벡터 유사검색·바이트 로딩 모두 이미 있음 —
- `PineconeClient.fetchVector(id)` — **이번에 추가**(`/vectors/fetch`). [N] 이미지의 저장 벡터를 재임베딩 없이 꺼냄(가장 정확·저비용).
- `SearchService.searchByVector(List<Float>, int)` (`SearchService.java:75-79`) — 010 SELF_CRITIQUE 도 쓰는 벡터 검색 경로(재사용).
- `FastApiClient.embedImage(byte[], mime)` + `ImageDownloadService.download(imageId)` — 폴백(A)용(재사용).
- `previousReferences`(Redis `SessionData`) — `ReferenceImage{imageId, index(1-based), url, ...}` 보유. index = 사용자 [N](§4.2 검증됨).

→ 결정(검증 후): **(C) 저장 벡터 fetch 가 1순위** — 이미 색인된 그 이미지의 벡터를 그대로 쓰는 게 가장 정확·저렴. embedImage(A)는 fetch 실패 시 폴백.

---

## 4. 설계 상세

### 4.1 트리거 감지 (결정론 우선)
- `RulePreRouter` 에 결정론 규칙 추가: **참조 지칭("[N]번"·"N번"·"레퍼런스 N") + 유사 의도("유사"·"비슷"·"같은 느낌")** 동시 매칭 시 → 새 액션/의도 `REFERENCE_SIMILAR` 로 라우팅. 룰이 명확하면 Grok 분류 콜 절약(S1' 트랙 A 철학).
- 핀 지칭("고정 N번"·"핀 N번")도 **별도 트리거(`isPinSimilar`/`extractPinIndex`)로 커버** → `PIN_SIMILAR`. 레퍼런스와 분리(앵커를 DB 핀에서 찾음)하되, 벡터 확보·검색·응답은 같은 공유 코어(`runSimilarSearch`)를 탄다. `chat()`에서 **핀 먼저** 체크(레퍼런스 트리거는 핀 접두어를 제거하므로 충돌 없음). 접두어 없는 "N번"은 [N] 레퍼런스로 해석.

### 4.2 앵커 해석
- 메시지에서 N 파싱(정규식, 1개 이상 허용은 후속). `StepContext.referencedImages` 슬롯(현재 미사용)을 실제로 채운다.
- N → `previousReferences.get(N-1)` (1-based). **previousReferences 인덱스 = 사용자가 본 [N]** 이 되도록 **핀 제외·재번호 일관성**을 보장(§4.4).
- 범위/부재 처리: previousReferences 비었거나 N 범위 밖 → **폴백**(§6).

### 4.3 유사검색 (구현됨)
- **(C, 1순위)** 앵커 `imageId → Image.sourceId → PineconeClient.fetchVector(sourceId)` → `searchByVector(vector, topK)`. 이미 색인된 벡터를 재사용 — 재임베딩·바이트 다운로드 0.
- **(A, 폴백)** fetch 가 null(미색인/장애)이면 `ImageDownloadService.download(imageId)` → `FastApiClient.embedImage(bytes, mime)` → `searchByVector`.
- **앵커 자기 자신 제외**: 결과에서 `r.id() == 앵커.imageId` 제거(자기 자신이 1위로 나오는 것 방지). 핀(`pinnedIds`)도 제외. 제외분 고려해 `topK+1+핀수` 로 넉넉히 뽑은 뒤 `topK`(=6) 로 자름.
- (참고) 태그 텍스트 검색은 더 거친 추가 폴백 — 이번 MVP 미포함(후속).

### 4.4 응답·인용 일관성
- 핀 제외 후 재번호가 사용자 [N] 과 어긋나는 문제: previousReferences 저장 시점과 화면 표시 [N] 의 **단일 출처**를 맞춘다. (저장 인덱스 = 표시 인덱스)
- 결과 그리드/인용 번호는 기존 `OutputIntegrityChecker` 경로 유지.

---

## 5. 코드 배선 지점 (구현 완료)
- `PineconeClient.fetchVector(id)` + `PineconeFetchResponse` DTO — **신규**(`/vectors/fetch`, 실패 시 null 반환→폴백 유도).
- `RulePreRouter.isReferenceSimilar` + `extractReferenceIndex` — 트리거·N 파싱(핀 제외). 단위 테스트 추가.
- `ChatLlmService`: `chat()` 에서 GENERATE_NOW 분기 뒤 `isReferenceSimilar` 체크 → `handleReferenceSimilar`(getOrRestore→앵커 해석→fetchVector/(폴백)embedImage→searchByVector→자기자신·핀 제외→ChatResponse). `resolveAnchorVector`/`referenceSimilarFallback` 헬퍼.
- **의도 기계(IntentCode/IntentRouting/StepContext)는 건드리지 않음** — `handleGenerateNow` 처럼 라우팅 전 전용 핸들러로 직접 응답하고, REFERENCE_SIMILAR 은 `ChatResponse` action 문자열로만 표기. → 새 IntentCode 추가 시 따라오는 ROUTING/COMPOSE 종착 검증(`WorkflowComposeProperties.validateLiveIntents`) 복잡도를 회피(설계 ①의 실용적 실현).
- `searchByVector`/`embedImage`/`ImageDownloadService`/`getOrRestore` — 재사용.

## 6. 엣지 / 리스크 / 폴백
- previousReferences 없음(콜드 세션/직전 검색 無) → "어떤 이미지를 말하는지 모르겠어요" 안내 또는 일반 검색 폴백.
- N 범위 밖 → 동일 폴백.
- 앵커 이미지 임베딩 실패(embed 장애) → 태그 텍스트 검색 폴백(§4.3 대안).
- compose-live ON 경로(chatViaWorkflow)와 레거시 경로 양쪽 일관성 — 핸들러를 `chat()` 진입부(라우팅 전)에 두어 양쪽 공통 처리(핀 제외/번호 일치).
- 핀 vs 레퍼런스 오인식(접두어) — 규칙 보수적으로(오탐 회피).

## 7. 범위 / 단계
- **MVP (이번 티켓)**: 단일 N 앵커 파싱 + previousReferences 해석 + embedImage→searchByVector + 자기 자신/핀 제외 + 폴백. 트리거는 RulePreRouter 결정론 규칙.
- **후속**: 다중 N("[1][2] 섞은 느낌"), 핀 번호 일관성 전면 정리, "유사" 외 변형 표현 확장, 임베딩 캐시.

## 8. 오픈 질문
1. `REFERENCE_SIMILAR` 를 **새 IntentCode** 로 둘지, 기존 NEW_SEARCH 에 "앵커 있으면 벡터검색" 분기를 얹을지.
2. ✅ **검증 완료: 정합 확인.** `ReferenceImage.index` = 사용자 표시 [N](1-based, 인용 무결성 키, `ReferenceImage.java:24`). 레거시(`buildReferenceContext` i+1, 핀 제외 리스트)·라이브(`excludePinned` 1..N 재부여) 양쪽 모두 **화면 [N] = Redis `previousReferences` index**. Redis 미스 시 MySQL `references_json` 동일 순서 복원. → `previousReferences.get(N-1)` 가 정확히 그 이미지. 별도 정합 수정 불필요.
3. embedImage 비용/지연 허용 범위(매 "유사" 요청마다 임베딩 1회) vs 태그 텍스트 폴백 기본화.
4. 트리거를 결정론 룰로만 둘지, Grok 분류에도 REFERENCE_SIMILAR 인식을 추가할지.
