# 채팅 (LLM) 시퀀스 다이어그램

AI 추천 파이프라인 진입(`POST /projects/{id}/chat`)에서 **의도(IntentCode)** 에 따라 갈라지는 흐름들. 핵심은 ⭐ NEW_SEARCH.


## ⭐ 레퍼런스 검색 (NEW_SEARCH) Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant CTL as ProjectChatController<br/>(POST /projects/{projectId}/chat)
    participant Chat as ChatLlmService
    participant Router as RulePreRouter / KeywordExtractor<br/>(routeIntent)
    participant WF as WorkflowService
    participant EKE as ExtractKeywordsExecutor
    participant KKE as KomoranKeywordExtractor
    participant SE as SearchExecutor
    participant SS as SearchService
    participant FA as FastApiClient (CLIP)
    participant PC as Pinecone
    participant DB as MySQL (DB)
    participant CE as ComposeExecutor
    participant OIC as OutputIntegrityChecker
    participant LLM as LlmService (Grok / Claude)
    participant RS as Redis (SessionService)

    C->>CTL: POST /projects/{projectId}/chat<br/>(principal, projectId, ChatRequest{message, sessionId, imageUrl})
    CTL->>Chat: chat(user, projectId, request)

    Chat->>DB: loadProjectAuthorized(user, projectId)
    Chat->>DB: resolveOrCreateSession(user, project, sessionId)
    Chat->>DB: findByChatSessionOrderByCreatedAtAsc(session)
    Note over Chat: trimHistory(all, maxHistory) → history<br/>핀(loadPinsQuietly) → pinnedIds + 고정맥락 주입

    %% ── 의도 분류 ──
    Chat->>Router: routeIntent(user, sessionId, message, history)
    alt 룰 히트 (RulePreRouter.route)
        Router-->>Chat: RoutedIntent(decision, ruleDecided=true)
    else 룰 미스 → Grok 폴백
        Router-->>Chat: RoutedIntent(decision=keywordExtractor.extract(...), ruleDecided=false)
    end
    Note over Chat: decision.action() == NEW_SEARCH<br/>(GENERATE_NOW·OUT_OF_DOMAIN·SELF_CRITIQUE 분기 아님)

    Chat->>Chat: intentResultAdapter.adapt(decision, ruleDecided, [], hasImage)

    %% ── live 게이트 ──
    alt workflowComposeProperties.isLive(NEW_SEARCH) == true  (live 워크플로 경로)
        Chat->>RS: sessionService.getOrRestore(userId, projectId, session)
        RS-->>Chat: SessionData(previousReferences)
        Chat->>DB: save(userMsg: ROLE=USER)
        Chat->>WF: run(intent, StepContext.startForCompose(...).withPinnedImageIds(pinnedIds))
        Note over WF: IntentRouting.ROUTING[NEW_SEARCH]<br/>= [EXTRACT_KEYWORDS, SEARCH, COMPOSE]

        %% EXTRACT_KEYWORDS
        WF->>EKE: execute(ctx)  [step 1]
        EKE->>KKE: extract(ctx.cleanedMessage())
        Note over KKE: Komoran 형태소 분석 → CONTENT_TAGS 필터 →<br/>STOPWORDS 제거 → ArtTermsDictionary 매핑<br/>(miss율 > 30% 면 LLM 폴백)
        KKE-->>EKE: List<String> keywords
        EKE-->>WF: ctx.withKeywords(keywords)

        %% SEARCH
        WF->>SE: execute(ctx)  [step 2]
        SE->>SS: search(SearchRequest(join(keywords," "), topK=10))
        SS->>FA: embedText(query)
        FA-->>SS: List<Float> (768차원 CLIP 벡터)
        SS->>PC: queryByVector(vector, fetchK=max(topK, BROAD_K=40))
        PC-->>SS: List<PineconeMatch>(id, score)
        SS->>DB: findBySourceIdIn(sourceIds)
        SS->>DB: findByImageIdIn(imageIds)  (ImageDraweTag)
        Note over SS: TagIdfIndex re-rank<br/>dense(CLIP) + Σidf 태그매칭 (cap 0.05) → topK 절단
        SS-->>SE: SearchResponse(results, count, query)
        Note over SE: 점수 가드 — avg<0.2 AND max<0.24 → blocked(low_score)<br/>그 외 ImageResult→ReferenceImage(1-based index)
        alt 점수 가드 차단 (blocked)
            SE-->>WF: ctx.withReferences([]).withSearchStats(blocked=true)
        else 유효 결과
            SE-->>WF: ctx.withReferences(refs).withSearchStats(blocked=false)
        end

        %% COMPOSE
        WF->>CE: execute(ctx)  [step 3]
        Note over CE: base = refs.isEmpty()? previousReferences : refs<br/>핀 제외(excludePinned) → buildReferenceContext([N] 인용 규칙)
        Note over Chat,LLM: provider = resolveProvider(user.getPlan()) → pickService<br/>PAID → Claude / 그 외 → Grok (List<LlmService> 중 provider() 일치)
        CE->>LLM: generate(LlmCallContext(history+refCtx, message, image, DRAW_GUIDE_SCHEMA_NAME))
        LLM-->>CE: LlmCallResult(content JSON, model, latencyMs)
        CE->>OIC: check(parsed.output(), refs)
        Note over OIC: 무결성 검사 — 유효 [1..N] 밖 환각 인용 제거
        OIC-->>CE: IntegrityResult(corrected output, 위반 카운트)
        CE-->>WF: ctx.withComposedOutput(finalOutput).withComposeModel/LatencyMs
        WF-->>Chat: finalCtx (composedOutput, references, searchStats)

        Note over Chat: 핀 제외 refs → toReferenceItems<br/>emitSearchAnalytics(SEARCH_EXECUTED/BLOCKED)<br/>emitDecisionAnalytics
        Chat->>DB: save(assistantMsg: ROLE=ASSISTANT, references)
        Chat->>RS: sessionService.save(sessionData.withSearchResult(NEW_SEARCH, [], refs))
        Note over Chat: offerGenerate = output.offerGenerate()<br/>|| (NEW_SEARCH && refs.isEmpty())
    else live off  (레거시 직접 합성 경로 — handleSearchDecision)
        Chat->>Chat: handleSearchDecision(user, project, sessionId, message, routed)
        Chat->>SS: search(SearchRequest(decision.keywords(), 10))
        SS->>FA: embedText(query)
        FA-->>SS: 768차원 벡터
        SS->>PC: queryByVector(vector, 40)
        PC-->>SS: matches
        SS->>DB: findBySourceIdIn / findByImageIdIn
        SS-->>Chat: SearchResponse(results)
        Note over Chat: 점수 가드 avg<0.2 AND max<0.24 → SEARCH_BLOCKED & 빈 결과<br/>핀 제외 후 references
        opt references.isEmpty() && action==NEW_SEARCH
            Note over Chat: offerGenerate = true ("AI 이미지 생성" 안내 톤)
        end
        Chat->>DB: save(userMsg) / save(assistantMsg)
        Chat->>LLM: generate(LlmCallContext(history+refCtx, message, image))
        LLM-->>Chat: LlmCallResult(content, model, latencyMs)
    end

    Chat-->>CTL: ChatResponse(sessionId, "guide", message, references[N], "NEW_SEARCH", offerGenerate, ...)
    CTL-->>C: 200 OK (ChatResponse: message, references[N], offerGenerate)
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
| --- | --- | --- |
| 목표 | 사용자 발화에서 키워드를 뽑아 CLIP 임베딩으로 유사 레퍼런스를 검색하고, 인용 가능한 가이드 답변을 합성한다 | NEW_SEARCH 는 검색·인용이 들어가는 챗봇의 핵심 플로우 (EXTRACT_KEYWORDS → SEARCH → COMPOSE) |
| 요청·인증 | `POST /projects/{projectId}/chat` → `ProjectChatController.chat(principal, projectId, request)` → `ChatLlmService.chat(user, projectId, request)` | `@AuthenticationPrincipal` 로 user 주입, `loadProjectAuthorized` 로 프로젝트 소유권 검증, `resolveOrCreateSession` 으로 세션 확보 |
| 의도 분류 | `routeIntent()` — 결정론적 `RulePreRouter.route` 먼저, 미스면 Grok `keywordExtractor.extract` 폴백 → `decision.action() == NEW_SEARCH` | 룰 히트/미스를 analytics(INTENT_RULE_HIT/MISS) + Micrometer 로 집계, 분류 latency 측정 (DoD ≤ 300ms) |
| 키워드 추출 | `ExtractKeywordsExecutor` → `KomoranKeywordExtractor.extract(cleanedMessage)` | Komoran 형태소 분석 → CONTENT_TAGS(NNG/NNP/VV/VA) 필터 → STOPWORDS 제거 → ArtTermsDictionary 한→영 매핑, 사전 미스율 > 30% 면 LLM 폴백 |
| 검색 + IDF re-rank | `SearchExecutor` → `SearchService.search` → `FastApiClient.embedText` (768차원) → `Pinecone.queryByVector(vector, 40)` → MySQL `findBySourceIdIn`·`findByImageIdIn` 메타 조인 → `TagIdfIndex` re-rank → topK 절단 | dense(CLIP) 위에 태그 IDF 매칭 소프트 점수(cap 0.05)를 얹어 재정렬. 점수 가드 `avg<0.2 AND max<0.24` 충족 시 무관 결과로 차단(blocked=low_score), 통과 시 ImageResult→ReferenceImage(1-based index) |
| COMPOSE + 무결성 | `ComposeExecutor` → `buildReferenceContext([N] 인용 규칙)` → `pickService(resolveProvider(plan)).generate(DRAW_GUIDE_SCHEMA_NAME)` → `OutputParser` → `OutputIntegrityChecker.check` | **provider 교체**: `resolveProvider(user.plan)` → PAID=Claude·그 외=Grok, `pickService` 가 `List<LlmService>` 에서 `provider()` 일치 빈 선택(Grok·Claude·Gemini). references 비면 previousReferences 재사용·핀 제외. 무결성 검사로 `1..refs.size()` 밖 환각 인용을 본문·citations 양쪽에서 결정론적으로 제거(재호출 없음) |
| 세션 저장 | `RedisSessionService.save(sessionData.withSearchResult(NEW_SEARCH, [], refs))` + MySQL `LlmMessage`(USER/ASSISTANT) 저장 | NEW_SEARCH 는 결과 유무와 무관하게 이번 턴 refs 로 단기메모리 덮어쓰기(0건이면 비움 = 화면과 일치, 다음 턴 KEEP lookup 일관), best-effort I/O |
| 응답 | `ChatResponse(sessionId, "guide", message, references[N], "NEW_SEARCH", offerGenerate, ...)` → `ApiResponse.success` → 200 OK | `offerGenerate = output.offerGenerate() || (NEW_SEARCH && refs.isEmpty())` — 검색은 했으나 적합 레퍼런스가 없으면 'AI 이미지 생성' 버튼 노출. CHAT_SUCCESS analytics + LLM Timer 메트릭 기록 |

## 멀티턴 이어묻기 (KEEP / FOLLOWUP) Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller as ProjectChatController
    participant ChatLlmService
    participant SessionService as SessionService(Redis)
    participant DB as MySQL(DB)
    participant ComposeExecutor
    participant LLM

    Client->>Controller: POST /projects/{projectId}/chat<br/>ChatRequest(message, sessionId, imageUrl)
    Controller->>ChatLlmService: chat(user, projectId, request)

    Note over ChatLlmService,DB: 인증·세션 확보
    ChatLlmService->>DB: loadProjectAuthorized(user, projectId)
    ChatLlmService->>DB: resolveOrCreateSession(user, project, request.sessionId())
    ChatLlmService->>DB: findByChatSessionOrderByCreatedAtAsc(session)
    DB-->>ChatLlmService: List<LlmMessage> (→ trimHistory: history)

    Note over ChatLlmService: 의도 분류 — routeIntent()<br/>RulePreRouter 룰 hit / miss 시 KeywordExtractor(Grok) 폴백<br/>→ ExtractionResult.action = KEEP / FOLLOWUP

    ChatLlmService->>ChatLlmService: intentResultAdapter.adapt(decision, ...) → IntentResult(code=KEEP/FOLLOWUP)
    Note over ChatLlmService: workflowComposeProperties.isLive(intent.code()) == true<br/>→ chatViaWorkflow(...) 진입 (live 경로)

    rect rgb(235,245,255)
    Note over ChatLlmService,DB: ① 단기메모리(Redis) 조회/복원 — getOrRestore<br/>Redis key = session:{userId}:{projectId}, TTL 24h
    ChatLlmService->>SessionService: getOrRestore(user.getId(), project.getId(), session)
    SessionService->>SessionService: readFromRedis("session:{userId}:{projectId}")

    alt Redis HIT (hot path)
        SessionService->>SessionService: redisTemplate.expire(key, TTL=24h) · hitCounter++
        SessionService-->>ChatLlmService: SessionData(previousReferences=직전 refs)
    else Redis MISS → MySQL 복원
        SessionService->>SessionService: missCounter++
        SessionService->>DB: findFirstByChatSessionAndRoleOrderByCreatedAtDesc(session, ASSISTANT)
        DB-->>SessionService: 직전 ASSISTANT LlmMessage (references_json)
        SessionService->>SessionService: convertToReferenceImages(references) → previousReferences
        SessionService->>SessionService: save(data) (Redis 재저장, TTL 24h) · restoredCounter++
        SessionService-->>ChatLlmService: SessionData(previousReferences=복원 refs)
    end
    end

    ChatLlmService->>ChatLlmService: List<ReferenceImage> previousReferences = sessionData.previousReferences()
    ChatLlmService->>ChatLlmService: StepContext.startForCompose(..., intent, previousReferences, history, provider)
    ChatLlmService->>DB: save(userMsg) (USER 메시지 저장)

    Note over ChatLlmService,ComposeExecutor: IntentRouting.ROUTING.get(KEEP/FOLLOWUP) = [COMPOSE] 만<br/>→ EXTRACT_KEYWORDS·SEARCH 없음 (검색 SKIP)

    ChatLlmService->>ComposeExecutor: workflowService.run(intent, initial) → execute(ctx)

    rect rgb(245,255,235)
    Note over ComposeExecutor: ctx.references() 가 비었음(검색 안 함)<br/>→ base = ctx.previousReferences() 재사용
    ComposeExecutor->>ComposeExecutor: base = references.isEmpty() ? previousReferences() : references()
    ComposeExecutor->>ComposeExecutor: refs = excludePinned(base, pinnedImageIds) (핀 제외·1..N 재부여)
    ComposeExecutor->>ComposeExecutor: buildReferenceContext(refs, code) → SYSTEM turn 추가
    end

    ComposeExecutor->>LLM: llm.generate(LlmCallContext(history, rawMessage, DRAW_GUIDE_SCHEMA_NAME))
    LLM-->>ComposeExecutor: LlmCallResult(content, model, latencyMs)
    ComposeExecutor->>ComposeExecutor: outputParser.parseWithSignal · integrityChecker.check(parsed, refs)
    ComposeExecutor-->>ChatLlmService: StepContext.withComposedOutput(finalOutput)

    ChatLlmService->>DB: save(assistantMsg) (ASSISTANT 메시지 + references 저장)

    Note over ChatLlmService,SessionService: ④ 단기메모리 갱신 — persistSessionMemory<br/>KEEP/SKIP → sessionData.withIntent(code) (직전 refs 유지)
    ChatLlmService->>SessionService: save(updated) (Redis, TTL 24h, best-effort)

    ChatLlmService-->>Controller: ChatResponse(sessionId, "guide", message, references,<br/>action="KEEP"/"FOLLOWUP", offerGenerate, ...)
    Controller-->>Client: ApiResponse.success(ChatResponse)
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
| --- | --- | --- |
| 목표 | 직전 턴의 참고 이미지(레퍼런스)를 **새로 검색하지 않고** 그대로 이어 활용해 멀티턴 대화 맥락을 유지한다 | `ComposeExecutor` 가 `ctx.references()` 가 비면 `ctx.previousReferences()` 로 폴백해 합성 컨텍스트를 구성 |
| 요청·인증 | `POST /projects/{projectId}/chat` → `ChatLlmService.chat(user, projectId, request)` | `loadProjectAuthorized` 로 소유 검증, `resolveOrCreateSession` 으로 `ChatSession` 확보, `findByChatSessionOrderByCreatedAtAsc` 로 history 로드 |
| 의도(KEEP/FOLLOWUP) | `routeIntent` → `RulePreRouter` 룰 hit, miss 시 `KeywordExtractor`(Grok) 폴백 → KEEP/FOLLOWUP 판정 후 live 게이트면 `chatViaWorkflow` 진입 | `intentResultAdapter.adapt` → `IntentResult`, `IntentRouting.ROUTING.get(KEEP/FOLLOWUP) = [COMPOSE]` 단일 스텝 — `EXTRACT_KEYWORDS`/`SEARCH` 없음(검색 스킵) |
| 단기메모리 조회(hit/miss) | `sessionService.getOrRestore(userId, projectId, session)` 로 Redis 단기메모리 조회 | Redis key `session:{userId}:{projectId}`, TTL 24h. **HIT** → 즉시 반환 + TTL 갱신. **MISS** → `findFirstByChatSessionAndRoleOrderByCreatedAtDesc(session, ASSISTANT)` 로 MySQL 직전 ASSISTANT references 복원 후 Redis 재저장 |
| COMPOSE 재사용 | `previousReferences` 를 `StepContext.startForCompose` 로 실어 보내고 `ComposeExecutor` 가 재사용 | `base = references.isEmpty() ? previousReferences() : references()` → `excludePinned` → `buildReferenceContext` SYSTEM turn 구성 → `DRAW_GUIDE_SCHEMA_NAME` 구조화 LLM 호출 → 파싱·무결성 검사 |
| 응답 | `ComposedOutput` 으로 `ChatResponse` 조립 후 `assistantMsg` 저장, `persistSessionMemory` 로 단기메모리 갱신 | KEEP/SKIP 은 `sessionData.withIntent(code)` 로 직전 refs 유지(검색 안 했으므로 덮어쓰지 않음). 응답 `action`="KEEP"/"FOLLOWUP", `ApiResponse.success(ChatResponse)` 반환 |

## COMPOSE 종착 의도 — 조언·비교·후속·도메인이탈·SKIP Sequence Diagram

검색 없이 **직전 맥락만으로 응답**하는 의도들은 `IntentRouting.ROUTING` 에서 `[COMPOSE]` 한 단계만 탄다. 대상은 **COMPARE**(비교) · **FOLLOWUP**(직전 답변 부연) · **COMPOSITION / LIGHTING / COLOR / TECHNIQUE**(미술 조언) · **KEEP**(맥락 유지) · **OUT_OF_DOMAIN**(도메인 이탈 거절) · **SKIP**(인사·감사·확인) 이다. 구조는 동일하나, **가이드 주입 위치가 의도마다 다르다**: OUT_OF_DOMAIN 은 분류 전용 게이트(`rulePreRouter.isOutOfDomain`)가 `chat()` 에서 `OUT_OF_DOMAIN_GUIDE` 를 history 에 먼저 주입한 뒤 워크플로로 넘기고, FOLLOWUP / COMPARE 는 `ComposeExecutor.buildReferenceContext` 가 references 가 비었을 때 전용 가이드를 만든다. 나머지(COMPOSITION/LIGHTING/COLOR/TECHNIQUE/KEEP/SKIP)는 별도 SYSTEM 가이드 없이 페르소나 + (있으면)직전 레퍼런스 컨텍스트로만 합성한다(검색·생성 없음).

```mermaid
sequenceDiagram
    participant C as Client
    participant CTL as ProjectChatController
    participant Chat as ChatLlmService
    participant Intent as RulePreRouter / KeywordExtractor(Grok)
    participant Sess as SessionService(Redis)
    participant WF as WorkflowService
    participant CE as ComposeExecutor
    participant LLM as LlmService (Grok / Claude)

    C->>CTL: POST /projects/{projectId}/chat (message)
    CTL->>Chat: chat(user, projectId, request)

    alt OUT_OF_DOMAIN 전용 게이트 (isOutOfDomain AND isLive(OUT_OF_DOMAIN))
        Note over Chat: routeIntent 결과와 무관 — rulePreRouter.isOutOfDomain 매치 시
        Chat->>Chat: history 에 OUT_OF_DOMAIN_GUIDE SYSTEM turn 추가 후 chatViaWorkflow
    else 그 외 (routeIntent → adapt → isLive(code))
        Chat->>Intent: routeIntent(user, sessionId, message, history)
        Intent-->>Chat: IntentCode (COMPARE / FOLLOWUP / COMPOSITION / LIGHTING / COLOR / TECHNIQUE / KEEP / SKIP)
    end
    Note over Chat: IntentRouting.ROUTING = [COMPOSE] — 검색·생성 없음

    Chat->>Sess: getOrRestore(user.getId, project.getId, session)
    Sess-->>Chat: SessionData(previousReferences) (있으면 합성 컨텍스트로 재사용)
    Chat->>WF: run(intent, StepContext.startForCompose(..., previousReferences, history))

    WF->>CE: execute(ctx)
    Note over CE: base = references.isEmpty ? previousReferences : references → excludePinned
    alt buildReferenceContext 분기 (references 비었을 때)
        Note over CE: code==FOLLOWUP → 후속 질문 안내 가이드
        Note over CE: code==COMPARE → 비교 안내 가이드
        Note over CE: 그 외 → 기본 '참고 이미지 없음' 안내 (인용·가짜결과 금지)
    end
    Note over CE: OUT_OF_DOMAIN_GUIDE 는 위에서 Chat 이 이미 history 에 넣어 옴 (CE 가 만들지 않음)
    CE->>LLM: generate(LlmCallContext(history, rawMessage, DRAW_GUIDE_SCHEMA_NAME))
    LLM-->>CE: LlmCallResult(content, model, latencyMs)
    CE->>CE: parseWithSignal → integrityChecker.check (범위밖 [N] 환각 인용 제거)
    CE-->>WF: ctx.withComposedOutput(finalOutput)
    WF-->>Chat: finalCtx

    Chat->>Sess: save (KEEP/SKIP/그외 → withIntent(code), previousReferences 유지)
    Chat-->>CTL: ChatResponse(action=referencesAction(code), offerGenerate)
    CTL-->>C: 200 OK
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
|:---|:---|:---|
| **목표** | 검색이 불필요한 의도를 직전 맥락만으로 응답 | `[COMPOSE]` 단일 단계 라우팅 |
| **대상 의도** | COMPARE · FOLLOWUP · COMPOSITION · LIGHTING · COLOR · TECHNIQUE · KEEP · OUT_OF_DOMAIN · SKIP | 모두 **COMPOSE 종착**(검색·생성 없음). `IntentRouting.ROUTING` 에서 전부 `[COMPOSE]` |
| **의도 분류** | OUT_OF_DOMAIN 은 `rulePreRouter.isOutOfDomain` 전용 게이트로 분류 전에 분기, 나머지는 `routeIntent`(룰 우선 → miss 면 Grok) → `intentResultAdapter.adapt` → `isLive(code)` | OUT_OF_DOMAIN/SELF_CRITIQUE 만 분류 앞 게이트, 그 외는 일반 분류 경로 |
| **맥락 재사용** | `sessionService.getOrRestore` 로 직전 레퍼런스를 `previousReferences` 로 받아 `StepContext` 에 실어 보냄 | `ComposeExecutor` 가 `references` 비면 `previousReferences` 로 폴백(합성 컨텍스트 전용) |
| **가이드 주입 위치** | OUT_OF_DOMAIN → `chat()` 이 `OUT_OF_DOMAIN_GUIDE` 를 history 에 선주입 / FOLLOWUP·COMPARE → `ComposeExecutor.buildReferenceContext`(refs 빈 경우) / 그 외 → 전용 가이드 없음 | 같은 `[COMPOSE]` 구조지만 가이드 출처가 다름(레거시처럼 의도별 SYSTEM 가이드를 chat() 이 일괄 주입하지 않음) |
| **무결성** | 응답의 `[N]` 인용을 `1..refs.size()` 로 검사 | `OutputIntegrityChecker.check` 가 범위 밖 환각 인용 제거 |
| **응답** | `ChatResponse(action=referencesAction(code), offerGenerate)` | `referencesAction`: COMPARE/FOLLOWUP/OUT_OF_DOMAIN/SKIP 은 그대로, KEEP·001~004 는 "KEEP". COMPOSE 종착이라 `offerGenerate` 은 대개 false(본문에 생성 안내 표현 감지 시만 true) |

## 자기비평 (SELF_CRITIQUE) Sequence Diagram

```mermaid
sequenceDiagram
    participant Client
    participant Controller as ProjectChatController
    participant Service as ChatLlmService
    participant Router as RulePreRouter
    participant Workflow as WorkflowService
    participant Critique as CritiqueUploadExecutor
    participant FastApi as FastApiClient (CLIP image embed)
    participant Search as SearchService
    participant Pinecone as PineconeClient (Vector DB)
    participant Compose as ComposeExecutor
    participant LLM as LlmService (multimodal vision)

    Client->>Controller: POST /projects/{projectId}/chat<br/>ChatRequest(message="이 그림 어때?", imageUrl, sessionId)
    activate Controller
    Controller->>Service: chat(user, projectId, request)
    activate Service

    Note over Service: imageInputResolver.resolve(user, request.imageUrl())<br/>→ image.hasImage()=true (업로드 작업물 bytes/mimeType 확보)

    Service->>Router: isCritiqueRequest(request.message())
    activate Router
    Router-->>Service: true ("어때/평가/피드백/봐줘…" CRITIQUE_REQUEST 정규식 매치)
    deactivate Router

    opt 010 게이트: image.hasImage() && isCritiqueRequest(message) && workflowComposeProperties.isLive(SELF_CRITIQUE)
        Note over Service: 세 조건 AND 충족 시에만 멀티모달 비평 경로.<br/>isLive(010) off 면 IntentResult 자체를 안 만들고 레거시 경로로 흘림(완전 무영향).
        Service->>Service: intentResultAdapter.adaptSelfCritique(List.of())<br/>→ IntentResult(SELF_CRITIQUE, hasImage=true, Tier.RULE)
        Service->>Service: llmMetrics.ruleHit("self_critique", "010")
        Service->>Service: chatViaWorkflow(user, project, session, request, image, history, critique, pinnedIds)
        Note over Service: StepContext.startForCompose(..., uploadedImageBytes, mimeType, provider)<br/>USER 메시지 저장(hasImage=true, imageUrl)

        Service->>Workflow: run(intent, initial)
        activate Workflow
        Note over Workflow: IntentRouting.ROUTING.get(SELF_CRITIQUE)<br/>= [CRITIQUE_UPLOAD, COMPOSE] 순차 실행

        Workflow->>Critique: execute(ctx)  [STEP 1 · CRITIQUE_UPLOAD]
        activate Critique
        Note over Critique: ctx.uploadedImageBytes() 방어 — 없으면 가이드 미주입 통과.<br/>유사 레퍼런스 검색은 부가가치: 실패해도 비평은 진행(빈 refs 폴백).

        Critique->>FastApi: embedImage(imageBytes, mimeType="image/jpeg")
        activate FastApi
        Note over FastApi: 업로드 작업물 → 768차원 CLIP 벡터<br/>(텍스트 검색과 동일 CLIP 공간이라 그대로 비교 가능)
        FastApi-->>Critique: List<Float> vector
        deactivate FastApi

        Critique->>Search: searchByVector(vector, CRITIQUE_TOP_K=4)
        activate Search
        Search->>Pinecone: queryByVector(vector, topK)
        activate Pinecone
        Pinecone-->>Search: List<PineconeMatch> (유사 작업물 id+score)
        deactivate Pinecone
        Note over Search: MySQL 메타 조회 → ImageResult 조립(Pinecone 순위 유지).<br/>벡터검색이라 태그 rerank 없음(echoQuery 빈 문자열).
        Search-->>Critique: SearchResponse(results)
        deactivate Search

        Note over Critique: 점수 가드 — avg<0.2 || max<0.21 이면 차단 → 빈 refs(텍스트 비전 비평 폴백).<br/>통과 시 ImageResult → ReferenceImage(1-based index) 변환.
        Note over Critique: 비평 가이드 SYSTEM turn 주입<br/>refs 있음 → CRITIQUE_GUIDE_WITH_REFS([N] 인용 허용)<br/>refs 없음 → CRITIQUE_GUIDE_NO_REFS([N] 인용 금지)
        Critique-->>Workflow: ctx.withHistory(guide).withReferences(refs)
        deactivate Critique

        Note over Workflow,Compose: 업로드 이미지가 임베딩·유사 레퍼런스 검색을 거친 뒤에야 COMPOSE 가 멀티모달 비평을 합성한다.
        Workflow->>Compose: execute(ctx)  [STEP 2 · COMPOSE]
        activate Compose
        Note over Compose: references → [N] referenceContext SYSTEM turn 구성
        Compose->>LLM: generate(LlmCallContext(history, rawMessage,<br/>uploadedImageBytes, mimeType, DRAW_GUIDE_SCHEMA_NAME))
        activate LLM
        Note over LLM: 멀티모달 비전 — 업로드 작업물 이미지를 직접 보고<br/>구도/명암/색/형태 관점 비평 (structured output)
        LLM-->>Compose: LlmCallResult(content, model, latencyMs)
        deactivate LLM
        Note over Compose: OutputParser 파싱 → OutputIntegrityChecker(범위 밖 [N] 환각 인용 제거)
        Compose-->>Workflow: ctx.withComposedOutput(finalOutput).withComposeModel/LatencyMs
        deactivate Compose

        Workflow-->>Service: finalCtx (composedOutput, references)
        deactivate Workflow

        Note over Service: ASSISTANT 메시지 저장 · CHAT_SUCCESS analytics · llmCall 메트릭<br/>referencesAction(SELF_CRITIQUE)="SELF_CRITIQUE"
        Service-->>Controller: ChatResponse(sessionId, "guide", 비평응답,<br/>references, "SELF_CRITIQUE", offerGenerate)
    end

    deactivate Service
    Controller-->>Client: ApiResponse.success(ChatResponse) — 비평 응답
    deactivate Controller
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
| --- | --- | --- |
| 목표 | 사용자가 채팅에 본인이 그린 작업물을 직접 업로드하고 평가를 요청하면, 그 이미지를 멀티모달 비전으로 비평한다 | 업로드 작업물에 대한 구도/명암/색/형태 관점의 구체적·건설적 피드백. 잘된 점 1가지 + 개선점 1~2가지를 권유 톤으로 제시하고, 비슷한 레퍼런스를 곁들여 "네 그림과 비슷한 [N]처럼…" 식 비교 비평 |
| 트리거 (이미지+비평요청+live) | `image.hasImage() && rulePreRouter.isCritiqueRequest(message) && workflowComposeProperties.isLive(SELF_CRITIQUE)` 세 조건 AND | 세 조건이 모두 참일 때만 `adaptSelfCritique` → `chatViaWorkflow`. `isCritiqueRequest`는 "어때/평가/피드백/봐줘/고칠 점/잘 그렸어" 등 결정론적 정규식(LLM 콜 0). 게이트가 분류 앞에 있어 `isLive(010)` off 면 010 IntentResult 자체를 안 만들고 레거시 경로로 흘려 완전 무영향. 이미지 신호와 AND 결합 — 이미지 없이 "어때?"는 일반 대화라 010 아님 |
| 업로드 이미지 임베딩 | `CritiqueUploadExecutor` → `FastApiClient.embedImage(imageBytes, mimeType)` | 업로드 작업물을 768차원 CLIP 벡터로 변환. 텍스트 검색과 동일 CLIP 공간이라 레퍼런스와 그대로 비교 가능. 임베딩/검색 예외는 비평을 막지 않고 빈 refs 로 폴백(부가가치 실패 격리, RuntimeException catch) |
| 유사 레퍼런스 검색 | `SearchService.searchByVector(vector, CRITIQUE_TOP_K=4)` → `PineconeClient.queryByVector` → MySQL 메타 조립 | 비평용은 '핵심 비교 몇 장'이라 top-K=4(기본 검색 10보다 적게). `searchByVector`는 텍스트 검색과 동일 조립 경로를 공유하되 텍스트 임베딩 단계만 건너뜀(REQUIRES_NEW 트랜잭션 격리). 점수 가드(avg<0.2 ‖ max<0.21) 통과분만 `ReferenceImage`(1-based)로 첨부, 차단/0건이면 텍스트(비전) 비평으로 폴백 |
| 멀티모달 COMPOSE | `WorkflowService.run` → `IntentRouting[SELF_CRITIQUE]=[CRITIQUE_UPLOAD, COMPOSE]` → `ComposeExecutor` → `LlmService.generate(uploadedImageBytes 포함)` | 업로드 이미지가 임베딩·유사 레퍼런스 검색을 거친 뒤에야 COMPOSE. 비평 가이드는 refs 유무로 분기(WITH_REFS: [N] 인용 허용 / NO_REFS: 인용 금지). LLM 이 업로드 작업물을 직접 보고 `DRAW_GUIDE_SCHEMA_NAME` structured output 으로 비평, `OutputIntegrityChecker` 가 범위 밖 환각 인용을 제거 |
| 응답 | `ChatResponse(sessionId, "guide", 비평응답, references, "SELF_CRITIQUE", offerGenerate)` | `referencesAction(SELF_CRITIQUE)`는 "SELF_CRITIQUE" 문자열을 그대로 노출(숫자 코드 "010" 비노출). ASSISTANT 메시지 저장 + CHAT_SUCCESS analytics + `llmCall` 메트릭 기록 후 비평 응답을 `ApiResponse.success`로 반환 |

## AI 이미지 생성 (GENERATE) Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller as ProjectChatController<br/>POST /projects/{projectId}/chat
    participant Chat as ChatLlmService
    participant Gen as ImageGenerationService
    participant Trans as PromptTranslator (Grok)
    participant Guide as GuideClient
    participant Store as ImageStorage
    participant Repo as ImageRepository / MySQL(DB)
    participant Index as AiImageIndexService<br/>(@Async, AFTER_COMMIT)

    Client->>Controller: chat(principal, projectId, ChatRequest{message, sessionId, imageUrl})
    Controller->>Chat: chat(user, projectId, request)

    Chat->>Chat: loadProjectAuthorized(user, projectId)
    Chat->>Chat: resolveOrCreateSession(user, project, request.sessionId())
    Chat->>Chat: routeIntent(user, sessionId, message, history)<br/>→ RulePreRouter 우선, miss 시 Grok KeywordExtractor 폴백
    Note over Chat: ExtractionResult decision = routed.decision()

    alt (A) 명시적 생성 — decision.action() == GENERATE_NOW
        Note over Chat: live 게이트(isLive)·검색·LLM 답변 진입 전 short-circuit<br/>→ handleGenerateNow(user, project, session, request, decision)
        Chat->>Repo: save(USER LlmMessage{content=message})

        Chat->>Gen: generate(user, decision.keywords(), project)
        Gen->>Trans: translate(user, prompt, project)<br/>KO 원문 + 프로젝트 subject/technique/mood
        Trans-->>Gen: englishPrompt (JSON {"prompt": "..."} 파싱·실패 시 원문 fallback)
        Gen->>Guide: generateImage(englishPrompt)
        Note over Guide: POST {baseUrl}/generate-image (배포 backend=bedrock)<br/>Bedrock PNG 바이트 직반환(임시 URL·폴링 없음)
        Guide-->>Gen: PNG bytes (Bedrock 생성물)
        Gen->>Gen: bytes 확보, mime (기본 image/png)
        Gen->>Store: store(user, bytes, mime)
        Store-->>Gen: Stored{id, url}
        Gen->>Repo: save(Image{source=AI, url, prompt=englishPrompt, createdBy})
        Repo-->>Gen: saved (id 확정)
        Gen->>Repo: save(saved.sourceId = "ai_" + id)
        Gen->>Index: publishEvent(AiImageCreatedEvent{imageId, bytes, mime, project})
        Note over Index: TX commit 후(AFTER_COMMIT) @Async 로<br/>CLIP 임베딩(FastApiClient) → Pinecone upsert → indexed_at/tag<br/>(응답 흐름과 무관, 실패해도 throw 안 함)
        Gen-->>Chat: Image saved
        Chat->>Repo: save(ASSISTANT LlmMessage{content="요청하신 이미지를 만들어드렸어요...", hasImage=true, imageUrl})
        Chat-->>Controller: ChatResponse{action="GENERATE_NOW",<br/>generatedImage = GeneratedImage(id, signed url, prompt)}

    else (B) 검색 0건 제안 — NEW_SEARCH && references empty (다음 턴 수락)
        Chat->>Chat: handleSearchDecision(...) → references 비어있음<br/>offerGenerate = (NEW_SEARCH && references.isEmpty())
        Note over Chat: 이번 턴은 "자료가 부족한 것 같아요. AI 이미지로 생성해드릴까요?"<br/>안내 톤으로 LLM 응답 + offerGenerate=true 만 반환(생성 X)
        Chat-->>Controller: ChatResponse{offerGenerate=true, generatePrompt=request.message()}
        Note over Client,Chat: 사용자가 다음 턴에 수락("응 만들어줘") →<br/>RulePreRouter 가 GENERATE_NOW 로 라우팅 → (A) 경로 재진입
    end

    Controller-->>Client: ApiResponse.success(ChatResponse) — 생성 이미지 url (signed)

    Note over Chat,Gen: ⚠ LEGACY: GENERATE 는 live 게이트 앞 short-circuit 으로만 동작.<br/>COMPOSE 워크플로에 종착(미종착)되지 않는 직접 합성 경로.
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
| --- | --- | --- |
| 목표 | 사용자가 원하는 이미지를 검색 대신 AI(Bedrock(guide))로 즉석 생성해 채팅 응답에 url 로 돌려준다 | `chat()` 진입 후 `routeIntent` 결과가 `GENERATE_NOW` 이면 검색·LLM 답변을 모두 건너뛴다 |
| 트리거 (명시) | "만들어줘" 등 명시적 생성 발화 → `decision.action() == GENERATE_NOW` | live 게이트(`isLive`)·검색·LLM 호출 **이전**에 `handleGenerateNow(...)` 로 short-circuit (할루시네이션 차단 위해 고정 안내 문구 사용) |
| 트리거 (검색 0건 제안) | `NEW_SEARCH` 인데 적합 레퍼런스 0건 → `offerGenerate=true` 안내만 반환 | 이번 턴은 생성하지 않고 제안 톤 응답 + `generatePrompt=message`. 사용자가 다음 턴에 수락하면 룰이 `GENERATE_NOW` 로 라우팅돼 (A) 경로로 들어간다 |
| 프롬프트 번역 | 한국어 원문 → 영문 image-gen 프롬프트(Bedrock(guide) 이미지 생성용) | `PromptTranslator.translate(user, prompt, project)` — 고정 모델 Grok, 프로젝트 subject/technique/mood 반영, `{"prompt":"..."}` JSON 파싱(실패 시 sanitize·원문 fallback), `prompt_translation_logs` 기록 |
| Bedrock(guide) 생성 | 영문 프롬프트로 guide `POST /generate-image` 호출 후 PNG 바이트 수신 | `GuideClient.generateImage(englishPrompt)` — `POST /generate-image`(배포 backend=bedrock). Bedrock 이 생성한 PNG 바이트를 직반환(임시 URL·폴링·다운로드 없음) |
| 저장 + 이벤트 | 다운로드 바이트를 우리 저장소·DB 로 영구화하고 인덱싱 이벤트 발행 | `ImageStorage.store` → `ImageRepository` 저장(`source=AI`, `prompt=englishPrompt`) → id 확정 후 `sourceId="ai_"+id` → `AiImageCreatedEvent` publish. `AiImageIndexService` 가 AFTER_COMMIT·@Async 로 CLIP→Pinecone upsert(응답과 비동기 분리) |
| 응답 | 생성 이미지 url 을 채팅 응답으로 반환 | `ChatResponse{action="GENERATE_NOW", generatedImage=GeneratedImage(id, signed url, prompt)}` — `imageUrlSigner.sign` 으로 서명된 url. ASSISTANT 메시지도 함께 저장 |
| 왜 LEGACY 인가 | GENERATE 는 신규 COMPOSE 워크플로에 종착되지 못한 직접 합성 경로로 남아있다 | ① 다른 의도와 달리 `COMPOSE 종착 계약`(스키마 강제 LLM→파싱→무결성)을 따르지 않음 ② `Image` 엔티티·`Bedrock(guide)/Storage` 인프라에 직접 의존 ③ guide 이미지 생성 등 부팅 검증 의존성이 있어 워크플로 단계로 일반화하기 전까지 live 게이트 앞 short-circuit 으로 유지 |

## 대화 초기화 (Reset) Sequence Diagram

```mermaid
sequenceDiagram
    participant Client
    participant Controller as ProjectChatController
    participant Service as ChatLlmService
    participant DB as LlmMessageRepository / MySQL
    participant Redis as SessionService (Redis)

    Client->>Controller: POST /projects/{projectId}/chat/{sessionId}/reset
    activate Controller
    Note over Controller: @AuthenticationPrincipal PrincipalDetails principal<br/>@PathVariable projectId, sessionId

    Controller->>Service: resetSession(user, projectId, sessionId)
    activate Service

    Note over Service: 소유권 검증 (auth/ownership check)
    Service->>Service: loadProjectAuthorized(user, projectId)
    Note right of Service: project.user.id != user.id → CustomException(FORBIDDEN)<br/>없으면 NOT_FOUND
    Service->>Service: loadSessionAuthorized(user, sessionId, projectId)
    Note right of Service: session.user.id != user.id<br/>또는 session.project.id != projectId → FORBIDDEN

    Note over Service,DB: ① DB 메시지 삭제 (SYSTEM/페르소나는 보존)
    Service->>DB: findByChatSessionOrderByCreatedAtAsc(session)
    activate DB
    DB-->>Service: List<LlmMessage> messages
    deactivate DB
    Service->>Service: nonSystem = messages.filter(role != SYSTEM)
    Service->>DB: deleteAll(nonSystem)
    activate DB
    DB-->>Service: deleted
    deactivate DB
    Service->>Service: session.setLastActive(Instant.now())

    Note over Service,Redis: ② Redis 단기메모리 삭제 (previousReferences / intent)
    Service->>Redis: clear(user.getId(), projectId)
    activate Redis
    Redis-->>Service: cleared
    deactivate Redis

    Note over DB,Redis: 컨텍스트를 완전히 초기화하려면<br/>DB 메시지 AND Redis 단기메모리를 모두 비워야 한다.<br/>Redis를 안 비우면 reset 후 첫 메시지의 getOrRestore가<br/>Redis HIT으로 옛 레퍼런스를 부활시켜 "초기화 안 된 것"처럼 보인다.

    Service-->>Controller: void (성공)
    deactivate Service
    Controller-->>Client: 200 OK ApiResponse.success({ "success": true })
    deactivate Controller
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
| --- | --- | --- |
| 목표 | 특정 세션의 대화 컨텍스트를 완전히 초기화한다 | DB의 대화 메시지와 Redis 단기메모리를 모두 비워, 이후 첫 메시지에 이전 턴·레퍼런스가 전혀 주입되지 않도록 보장 |
| 요청·인증 | `POST /projects/{projectId}/chat/{sessionId}/reset` → `ProjectChatController.reset()` → `ChatLlmService.resetSession(user, projectId, sessionId)` | `@AuthenticationPrincipal`로 사용자 추출. `loadProjectAuthorized`(project.user 소유권)와 `loadSessionAuthorized`(session.user + session.project 일치) 이중 검증, 불일치 시 `CustomException(FORBIDDEN)`, 미존재 시 `NOT_FOUND` |
| DB 메시지 삭제 | `findByChatSessionOrderByCreatedAtAsc`로 메시지 조회 후 `deleteAll(nonSystem)` | `MessageRole.SYSTEM`(페르소나/시스템 프롬프트)은 필터로 보존하고 USER/ASSISTANT 메시지만 삭제. 이후 `session.setLastActive(now)`로 활동 시각 갱신. `@Transactional` |
| Redis 단기메모리 삭제 | `sessionService.clear(user.getId(), projectId)` | previousReferences/intent 등 단기메모리(short-term memory)를 명시적으로 제거. 버그 수정 근거: 과거에 이 clear가 누락되어 reset 후 `getOrRestore`가 Redis HIT으로 옛 레퍼런스를 복원 → 이전 컨텍스트가 leak되어 "초기화가 안 된" 것처럼 동작했음. DB + Redis 둘 다 비워야 맥락이 완전히 초기화됨 |
| 응답 | `ApiResponse.success(Map.of("success", true))` | `200 OK { "success": true }` 반환. 본문 데이터 없이 성공 여부만 전달 |
