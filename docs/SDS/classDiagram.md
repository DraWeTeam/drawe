# 7. Class Diagram

## 7.1 AI 추천 파이프라인 (컴포넌트) ⭐
`ChatLlmService`가 오케스트레이션하고, live 경로는 `WorkflowService`가 `StepExecutor` 체인을 실행한다.

```mermaid
classDiagram
    direction LR

    class ChatLlmService {
        <<Service>>
        +chat(user, projectId, request) ChatResponse
        +chatViaWorkflow(...) ChatResponse
        +generateImage(user, projectId, sessionId, req) GenerateImageResponse
        +getHistory(user, projectId, sessionId) ChatHistoryResponse
        +resetSession(user, projectId, sessionId) void
        -describePin(PinItem) String
        -buildReferenceContext(refs) String
    }

    class WorkflowService {
        <<Service>>
        +run(intent: IntentResult, initial: StepContext) StepContext
    }

    class StepExecutor {
        <<interface>>
        +type() StepType
        +execute(ctx: StepContext) StepContext
    }

    class ExtractKeywordsExecutor
    class SearchExecutor {
        +execute(ctx) StepContext
        -collectTags(ImageResult) List~String~
        -toReferenceImage(ImageResult, index) ReferenceImage
    }
    class ComposeExecutor {
        +execute(ctx) StepContext
        -buildReferenceContext(refs, code) String
        -excludePinned(refs, pinnedIds) List~ReferenceImage~
    }
    class CritiqueUploadExecutor
    class GenerateImageExecutor
    class TranslateExecutor

    class StepContext {
        <<record>>
        +references: List~ReferenceImage~
        +previousReferences: List~ReferenceImage~
        +pinnedImageIds: Set~Long~
        +composedOutput
    }

    ChatLlmService ..> WorkflowService : live 경로
    WorkflowService o--> StepExecutor : 체인 실행
    StepExecutor <|.. ExtractKeywordsExecutor
    StepExecutor <|.. SearchExecutor
    StepExecutor <|.. ComposeExecutor
    StepExecutor <|.. CritiqueUploadExecutor
    StepExecutor <|.. GenerateImageExecutor
    StepExecutor <|.. TranslateExecutor
    StepExecutor ..> StepContext : 입출력
    SearchExecutor ..> SearchService : 검색
    ComposeExecutor ..> LlmService : 합성
```

| 클래스 | 책임 |
|---|---|
| `ChatLlmService` | 의도 분류·세션·legacy/live 분기, 응답 조립 |
| `WorkflowService` | 의도 라우팅에 따라 StepExecutor 체인 실행 |
| `StepExecutor`(+6 구현) | 단계별 처리(키워드·검색·합성·번역·생성·비평) |
| `StepContext` | 단계 간 전달 컨텍스트(refs·pinnedIds·output) |

## 7.2 검색 컴포넌트
```mermaid
classDiagram
    direction LR
    class SearchService {
        <<Service>>
        +search(req: SearchRequest) SearchResponse
        +searchByVector(vector, topK) SearchResponse
        -tagBoost(r, queryTokens) double
        -tagTokens(r) Set~String~
    }
    class TagIdfIndex {
        <<Component>>
        +idf(token: String) double
        +tokensOf(values) Set~String~$
    }
    class PineconeClient {
        +queryByVector(vector, topK) List~PineconeMatch~
    }
    class FastApiClient {
        +embedText(query) List~Float~
        +embedImage(bytes) List~Float~
    }
    SearchService ..> FastApiClient : 임베딩
    SearchService ..> PineconeClient : 벡터검색
    SearchService ..> TagIdfIndex : IDF 가중
    SearchService ..> ImageRepository : 메타 조회
```
- **IDF re-rank**: `SearchService`가 Pinecone 결과를 `TagIdfIndex.idf()` 로 가중해 재정렬.

## 7.3 도메인 엔티티 모델
```mermaid
classDiagram
    direction LR

    class User { +id; +email }
    class Project { +id; +name; +subject; +technique; +mood; +status; +pinnedImageIds }
    class ProjectReference { +id; +addedAt }
    class Image { +id; +source; +sourceId; +url; +rawTags; +prompt; +aiDescription }
    class ImageDraweTag { +technique; +subject; +mood; +utility; +freeTags }
    class ChatSession { +id; +lastActive }
    class LlmMessage { +id; +role; +content; +provider; +references }
    class Guide { +id }
    class GuideFeedback { +id; +feedback }

    User "1" --> "0..*" Project : 소유
    User "1" --> "0..*" ChatSession
    Project "1" --> "0..*" ProjectReference
    ProjectReference "1" --> "1" Image
    Image "1" --> "0..1" ImageDraweTag
    ChatSession "1" --> "0..*" LlmMessage
    Project "1" --> "0..*" Guide
    Guide "1" --> "0..*" GuideFeedback
```

| 엔티티 | 설명 |
|---|---|
| `Project` | 그림 작업 단위(주제·기법·분위기·핀목록) |
| `Image` | Unsplash/AI 이미지(+`aiDescription` 캡션) |
| `ImageDraweTag` | 이미지의 GPT 태깅(기법·주제·분위기·freeTags) |
| `ChatSession`·`LlmMessage` | 대화 세션·메시지(role·references) |
| `ProjectReference` | 프로젝트-이미지 N:M 연결(레퍼런스 아카이브) |

> 도메인별 Controller·Service·Repository는 동일한 계층 패턴(Controller → Service → Repository)을 따른다.
