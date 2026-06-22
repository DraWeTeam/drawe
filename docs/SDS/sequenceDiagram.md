# 8. Sequence Diagram

도메인별 핵심 흐름. **AI 추천 파이프라인(8.1)** 을 가장 상세히 다룬다.

---

## 8.1 레퍼런스 검색 (NEW_SEARCH) ⭐
사용자 메시지 → 의도 분류 → 키워드 추출 → CLIP 검색 → IDF re-rank → COMPOSE.

```mermaid
sequenceDiagram
    participant C as Client
    participant CTL as ProjectChatController
    participant Chat as ChatLlmService
    participant Intent as RulePreRouter / Grok
    participant WF as WorkflowService
    participant KW as ExtractKeywordsExecutor<br/>(Komoran + 사전 + Grok)
    participant SE as SearchExecutor
    participant SS as SearchService
    participant EMB as fastapi-embed (CLIP)
    participant PC as Pinecone
    participant DB as MySQL
    participant CE as ComposeExecutor
    participant LLM as LLM (Grok/Gemini/Claude)

    C->>CTL: POST /projects/{id}/chat (message)
    CTL->>Chat: chat(user, projectId, request)
    Chat->>Intent: 의도 분류
    Intent-->>Chat: IntentCode = NEW_SEARCH
    Note over Chat: live 게이트 통과 → chatViaWorkflow
    Chat->>WF: run(ctx, ROUTING[NEW_SEARCH])

    WF->>KW: EXTRACT_KEYWORDS
    KW-->>WF: 영문 키워드(불용어 제거·복합어 보존)

    WF->>SE: SEARCH
    SE->>SS: search(keywords)
    SS->>EMB: embedText(query)
    EMB-->>SS: 768d 벡터
    SS->>PC: queryByVector(top-K overfetch)
    PC-->>SS: 후보 ID + score
    SS->>DB: findBySourceIdIn(ids) (메타·태그)
    DB-->>SS: 이미지 메타
    SS->>SS: 태그 IDF re-rank → topK + 점수 가드
    SS-->>SE: ImageResult[]
    SE-->>WF: ReferenceImage[] (1-based)

    WF->>CE: COMPOSE
    CE->>CE: referenceContext 구성<br/>(태그 + ai_description 캡션, 핀 제외)
    CE->>LLM: generate(schema 강제)
    LLM-->>CE: 합성 결과
    CE->>CE: 출력 무결성 검사(환각 인용 제거)
    CE-->>WF: ComposedOutput
    WF-->>Chat: finalCtx

    Chat->>DB: LlmMessage 저장(USER/ASSISTANT)
    Chat->>Chat: Redis 단기메모리 저장(previousReferences)
    Chat-->>CTL: ChatResponse(message, references[N], offerGenerate)
    CTL-->>C: 200 OK
```

| 단계 | 핵심 |
|---|---|
| 의도 분류 | Rule 우선 + Grok. NEW_SEARCH면 검색 경로 |
| 키워드 추출 | 형태소 + 미술사전(247) + Grok 폴백, 요청 동사 불용어 |
| 검색 | CLIP→Pinecone overfetch→MySQL 메타→**IDF re-rank**→점수 가드 |
| COMPOSE | 태그+**ai_description** 주입, 스키마 LLM, 무결성 검사 |
| 저장 | LlmMessage(DB) + previousReferences(Redis) |

---

## 8.2 멀티턴 이어묻기 (KEEP)
```mermaid
sequenceDiagram
    participant C as Client
    participant Chat as ChatLlmService
    participant Sess as SessionService(Redis)
    participant CE as ComposeExecutor
    participant LLM as LLM

    C->>Chat: "아까 그거 더 보여줘"
    Chat->>Sess: getOrRestore(userId, projectId)
    alt Redis hit
        Sess-->>Chat: previousReferences
    else miss
        Sess->>Sess: MySQL 직전 ASSISTANT references 복원
        Sess-->>Chat: previousReferences
    end
    Chat->>CE: COMPOSE (검색 없이 직전 refs 재사용)
    CE->>LLM: generate
    LLM-->>CE: 응답
    CE-->>C: 직전 레퍼런스 인용 응답
```

## 8.3 대화 초기화
```mermaid
sequenceDiagram
    participant C as Client
    participant Chat as ChatLlmService
    participant DB as MySQL
    participant R as Redis
    C->>Chat: POST /chat/{sessionId}/reset
    Chat->>DB: deleteAll(non-SYSTEM 메시지)
    Chat->>R: sessionService.clear(userId, projectId)
    Note over Chat: DB + Redis 둘 다 비워야 맥락 완전 삭제
    Chat-->>C: { success: true }
```

## 8.4 AI 이미지 생성 (검색 결과 없음 / GENERATE)
```mermaid
sequenceDiagram
    participant C as Client
    participant Chat as ChatLlmService
    participant TR as TranslateStep
    participant Bria
    participant DB as MySQL
    C->>Chat: 생성 요청 (또는 검색 0건 → 생성 제안 수락)
    Chat->>TR: TRANSLATE (한→영 프롬프트)
    TR->>Bria: GENERATE_IMAGE(prompt)
    Bria-->>Chat: 생성 이미지 URL
    Chat->>DB: Image(source=AI) + LlmMessage 저장
    Chat-->>C: 생성 이미지
```

## 8.5 자기비평 (SELF_CRITIQUE)
```mermaid
sequenceDiagram
    participant C as Client
    participant Chat as ChatLlmService
    participant CU as CritiqueUploadExecutor
    participant EMB as fastapi-embed
    participant SS as SearchService
    participant CE as ComposeExecutor
    C->>Chat: 그림 첨부 + "이거 평가해줘"
    Chat->>CU: CRITIQUE_UPLOAD
    CU->>EMB: embedImage(업로드 그림)
    CU->>SS: searchByVector (유사 레퍼런스)
    CU-->>Chat: 비평 컨텍스트 + 유사 refs
    Chat->>CE: COMPOSE (비평 + 레퍼런스)
    CE-->>C: 비평 응답
```

## 8.6 가이드 (이미지 업로드)
```mermaid
sequenceDiagram
    participant C as Client
    participant GC as GuideController
    participant FG as fastapi-guide
    participant QD as Qdrant
    participant DB as MySQL
    C->>GC: POST /projects/{id}/guide (그림)
    GC->>FG: 진단 요청 (user_id=growth 키)
    FG->>FG: 장면·포즈·주제 분석 → 진단
    FG->>QD: 유사 레퍼런스 검색(취향 boost)
    QD-->>FG: 레퍼런스
    FG->>FG: 코칭 LLM + growth 갱신
    FG-->>GC: GuideResponse(진단·코칭·refs·growth)
    GC->>DB: Guide 저장
    GC-->>C: 가이드 카드
```

## 8.7 인증 (Google OAuth 로그인)
```mermaid
sequenceDiagram
    participant C as Client
    participant BE as Backend(Security)
    participant G as Google OAuth2
    participant R as Redis
    participant DB as MySQL
    C->>BE: 로그인 시작
    BE->>R: authorization request(state) 저장
    BE->>G: redirect (OAuth2)
    G-->>BE: code 콜백
    BE->>G: 토큰 교환 → 프로필
    BE->>DB: User 조회/생성
    BE->>BE: JWT(access/refresh) 발급
    BE-->>C: 프론트 콜백 + 토큰
```

## 8.8 프로젝트 목록 (정렬·검색)
```mermaid
sequenceDiagram
    participant C as Client
    participant CTL as ProjectController
    participant SVC as ProjectService
    participant Repo as ProjectRepository(QueryDSL)
    C->>CTL: GET /projects?q=&status=&sort=
    CTL->>SVC: getList(user, q, status, sort, page)
    SVC->>Repo: findPage + countPage<br/>(searchContains + statusEq + sort)
    Repo-->>SVC: Project[] + total
    SVC-->>C: ProjectListResponse(items, total, hasMore)
```

> 핀 추가/해제, 갤러리 조회 등 단순 CRUD는 위와 동일한 Controller→Service→Repository 패턴을 따른다.
