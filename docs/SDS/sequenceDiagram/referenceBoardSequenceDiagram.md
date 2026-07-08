# 레퍼런스 보드 시퀀스 다이어그램

레퍼런스 보드(`/projects/{projectId}/reference-board`) — 현행 레퍼런스 탐색·생성의 1차 유저 surface. ⭐ **키워드 검색**, **AI 생성(보드 통합)**, **좋아요/싫어요 피드백**의 세 흐름.

## ⭐ 1) 키워드 검색 (GET /search) Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Ctl as ReferenceBoardController
    participant Svc as ReferenceBoardService
    participant KW as KomoranKeywordExtractor
    participant Search as SearchService
    participant Feedback as ImageFeedbackRepository
    participant DB as MySQL(DB)

    Client->>Ctl: GET /projects/{projectId}/reference-board/search?q&source&topK
    Ctl->>Svc: search(user, projectId, query, ReferenceSource.from(source), topK)
    alt source == ARCHIVE
        Svc->>DB: projectReferenceRepository.searchByKeyword(user, %q%) — 저장 레퍼런스 텍스트검색
    else 코퍼스 검색(ALL/AI/PHOTO)
        Svc->>Svc: pinnedImageIds(user, projectId) — 소유 검증 + 핀 집합
        Svc->>KW: extract(query) — Komoran 형태소 + ArtTerms KO→EN (미스율>30% Grok 폴백)
        KW-->>Svc: List~String~ keywords
        Svc->>Search: search(new SearchRequest(join(keywords), CANDIDATE_K=40))
        Note over Search: CLIP ViT-L/14(768d) 임베딩 → Pinecone queryByVector → 태그 IDF 재정렬
        Search-->>Svc: SearchResponse raw
        Svc->>Svc: 관련성 게이트 — 태그 미매칭 OR max<0.18 → blocked=true(→ 생성 유도)
        opt !blocked
            Svc->>Feedback: findImageIdsByUserAndFeedback(user, DISLIKE/LIKE)
            Svc->>Svc: 핀·싫어요 제외 → 상위 limit → ReferenceCard(signImg, "LIKE"|null)
            Svc->>DB: 결과 있으면 project.lastReferenceQuery = query 저장(재진입 복원)
        end
    end
    Svc-->>Ctl: ReferenceBoardSearchResponse{results, total, query, source, blocked}
    Ctl-->>Client: ApiResponse.success(...)
```

## ⭐ 2) AI 생성 (POST /generate) Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Ctl as ReferenceBoardController
    participant Svc as ReferenceBoardService
    participant Gen as ImageGenerationService
    participant Guide as GuideClient
    participant FA as fastapi-guide (Bedrock Stability)
    participant DB as MySQL(DB)

    Note over Client,DB: 원하는 레퍼런스가 없을 때(검색 blocked / 싫어요 3회) 보드에서 직접 생성
    Client->>Ctl: POST /projects/{projectId}/reference-board/generate {prompt}
    Ctl->>Svc: generateReference(user, projectId, prompt)
    Svc->>DB: projectRepository.findById — 소유 검증(NOT_FOUND/FORBIDDEN)
    Svc->>Gen: generate(user, prompt, project)
    Gen->>Guide: generateImage(englishPrompt)
    Guide->>FA: POST /generate-image (배포 backend=bedrock)
    FA-->>Guide: PNG 바이트(Bedrock Stability 생성물)
    Gen->>DB: ImageStorage.store → Image(source=AI) 저장 + AiImageCreatedEvent(비동기 CLIP 인덱싱)
    Gen-->>Svc: Image
    Svc->>DB: ReferenceGeneration 저장(prompt 500자, imageId, url, createdAt) — SCRUM-118 생성 대화 이력
    Svc-->>Ctl: {imageId, signed(url)}
    Ctl-->>Client: ApiResponse.success — 프론트 즉시 미리보기·담기

    Note over Client,Ctl: 보드 재진입 시 GET /projects/{projectId}/reference-board/generations → generationHistory(시간순, url 재서명)로 생성 채팅 복원
```

## ⭐ 3) 좋아요/싫어요 피드백 (POST /images/{id}/like·dislike) Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Ctl as ReferenceBoardController
    participant Svc as ReferenceBoardService
    participant FB as ImageFeedbackService
    participant Session as ReferenceBoardSessionService
    participant Redis as Redis(refboard:)

    alt 좋아요
        Client->>Ctl: POST /projects/{projectId}/reference-board/images/{imageId}/like
        Ctl->>Svc: like(user, projectId, imageId)
        Svc->>FB: saveFeedback(user, imageId, LIKE) — 반응만 저장(정렬·유지용, 랭킹 무반영)
        Svc->>Session: get(userId, projectId)
        Svc-->>Ctl: ReactionResponse{imageId, "LIKE", dislikeCount, suggestGeneration=false}
    else 싫어요
        Client->>Ctl: POST /projects/{projectId}/reference-board/images/{imageId}/dislike
        Ctl->>Svc: dislike(user, projectId, imageId)
        Svc->>FB: saveFeedback(user, imageId, DISLIKE) — 향후 검색에서 제외
        Svc->>Session: get(userId, projectId) → incrementDislike()
        Session->>Redis: save(session) (TTL 6h)
        Svc-->>Ctl: ReactionResponse{imageId, "DISLIKE", count, suggestGeneration = count>=3}
        opt count >= 3 (생성 유도 모달)
            Client->>Ctl: POST /projects/{projectId}/reference-board/generation-suggestion/ack (모달 노출 후)
            Ctl->>Svc: ackGenerationSuggestion(user, projectId)
            Svc->>Session: resetDislike() → save
        end
    end
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
| --- | --- | --- |
| 검색 (⭐) | `search` → `searchCorpus`: Komoran+ArtTerms 키워드 → `SearchService`(CLIP→Pinecone) → 관련성 게이트 → 핀·싫어요 제외 → `ReferenceCard[]` | 의도 라우팅 없음(순수 키워드). `blocked`(태그 미매칭 or `max<0.18`)면 결과 비우고 생성 유도. 결과 있으면 `lastReferenceQuery` 저장(재진입 복원). ARCHIVE는 저장 레퍼런스 텍스트검색(별도 경로) |
| AI 생성 (⭐) | `generateReference` → `imageGenerationService.generate`(→ `GuideClient` → **Bedrock Stability**) → `ReferenceGeneration` 이력 저장 → `{imageId, signed(url)}` | `@Transactional`, 소유 검증(NOT_FOUND/FORBIDDEN). 생성 대화(프롬프트 500자→이미지)를 저장해 보드 재진입 시 `GET /projects/{projectId}/reference-board/generations`로 채팅 복원(SCRUM-118) |
| 피드백 (⭐) | `like`/`dislike`/`removeReaction` → `ImageFeedbackService` 영속 + `ReferenceBoardSession.dislikeCount` | 좋아요=반응 저장(정렬·유지용, **검색 랭킹 무반영**). 싫어요=향후 검색 제외 + `dislikeCount` 증가, **3회 도달 시 `suggestGeneration=true`**(생성 모달). 모달 노출 후 `ack`로 카운터 리셋 |
| 세션 격리 | 싫어요 카운터는 챗 세션과 분리된 `ReferenceBoardSession`(Redis `refboard:`, TTL 6h) | 순수 세션성 — MySQL 폴백 없이 best-effort. Redis 장애 시 새 세션으로 진행(검색은 항상 상위 결과라 deterministic, shown dedup 불필요) |
| 재활용 | 검색=`SearchService`, 생성=`ImageGenerationService`, 피드백=`ImageFeedbackService`를 그대로 재활용 | 보드는 소스필터·핀/싫어요 제외·세션 카운터만 얹는 오케스트레이션 레이어(검색·이미지 도메인 무변경) |
