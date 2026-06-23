## Image Class Diagram

```mermaid
classDiagram
    direction LR

    class ImageController {
        <<Controller>>
        -imageUploadService: ImageUploadService
        -imageStorage: DbImageStorage
        +upload(principal: PrincipalDetails, file: MultipartFile): ApiResponse~ImageUploadResponse~
        +view(principal: PrincipalDetails, id: Long, download: boolean): ResponseEntity~byte[]~
    }

    class ImageFeedbackController {
        <<Controller>>
        -feedbackService: ImageFeedbackService
        +getFeedback(principal: PrincipalDetails, imageId: Long): ResponseEntity~ApiResponse~FeedbackResponse~~
        +saveFeedback(principal: PrincipalDetails, imageId: Long, request: FeedbackRequest): ResponseEntity~ApiResponse~Void~~
        +removeFeedback(principal: PrincipalDetails, imageId: Long): ResponseEntity~ApiResponse~Void~~
    }

    class ImageUploadService {
        <<Service>>
        -ALLOWED_MIMES: Set~String~
        -imageStorage: ImageStorage
        -maxSizeBytes: long
        +upload(user: User, file: MultipartFile): ImageStorage.Stored
    }

    class ImageFeedbackService {
        <<Service>>
        -feedbackRepository: ImageFeedbackRepository
        -imageRepository: ImageRepository
        +saveFeedback(user: User, imageId: Long, type: FeedbackType): void
        +removeFeedback(user: User, imageId: Long): void
        +getFeedback(user: User, imageId: Long): FeedbackResponse
    }

    class ImageStorage {
        <<interface>>
        +store(owner: User, data: byte[], mimeType: String): Stored
        +load(id: Long): Loaded
    }

    class DbImageStorage {
        <<Service>>
        -imageBlobRepository: ImageBlobRepository
        +store(owner: User, data: byte[], mimeType: String): Stored
        +load(id: Long): Loaded
    }

    class S3ImageStorage {
        <<Service>>
        +S3_URL_PREFIX: String
        -DEFAULT_EXT: String
        -s3Client: S3Client
        -props: S3Properties
        +S3ImageStorage(s3Client: S3Client, props: S3Properties)
        +store(owner: User, data: byte[], mimeType: String): Stored
        +load(id: Long): Loaded
    }

    class ImageUrlSigner {
        <<Component>>
        -HMAC_ALGO: String
        -PATH_PREFIX: String
        -key: SecretKeySpec
        -ttlSeconds: long
        -s3Presigner: S3Presigner
        -s3Properties: S3Properties
        +ImageUrlSigner(secret: String, ttlSeconds: long, s3PresignerProvider: ObjectProvider~S3Presigner~, s3PropertiesProvider: ObjectProvider~S3Properties~)
        +sign(relativeUrl: String): String
        +verify(id: Long, exp: long, sig: String): boolean
    }

    class AiImageIndexService {
        <<Service>>
        -fastApiClient: FastApiClient
        -pineconeClient: PineconeClient
        -imageRepository: ImageRepository
        -txService: AiImageIndexTxService
        +onAiImageCreated(event: AiImageCreatedEvent): void
        +indexAsync(imageId: Long, imageBytes: byte[], mimeType: String, project: Project): void
    }

    class AiImageIndexTxService {
        <<Service>>
        -imageRepository: ImageRepository
        -imageDraweTagRepository: ImageDraweTagRepository
        +markIndexedAndSeedTag(imageId: Long, project: Project): void
    }

    class ImageGenerationService {
        <<Service>>
        -DEFAULT_MIME: String
        -briaClient: BriaClient
        -imageStorage: ImageStorage
        -imageRepository: ImageRepository
        -promptTranslator: PromptTranslator
        -eventPublisher: ApplicationEventPublisher
        -analyticsEventService: AnalyticsEventService
        -downloader: RestClient
        +generate(user: User, prompt: String, project: Project): Image
    }

    class ImageRepository {
        <<Repository>>
        +findBySourceIdIn(sourceIds: List~String~): List~Image~
        +findByIsOnboardingTrue(): List~Image~
        +findAllRawTagsJson(): List~String~
        +findAllPrompts(): List~String~
        +findCompletedGallery(source: ImageSource, createdBy: User, pageable: Pageable): Page~Image~
    }

    class ImageBlobRepository {
        <<Repository>>
    }

    class ImageDraweTagRepository {
        <<Repository>>
        +findByImageIdIn(imageIds: List~Long~): List~ImageDraweTag~
    }

    class ImageFeedbackRepository {
        <<Repository>>
        +findByUserAndImage(user: User, image: Image): Optional~ImageFeedback~
    }

    class Image {
        <<Entity>>
        -id: Long
        -source: ImageSource
        -sourceId: String
        -url: String
        -embeddingId: String
        -photographerUsername: String
        -photographerName: String
        -isOnboarding: Boolean
        -isTagged: Boolean
        -rawTags: List~String~
        -prompt: String
        -aiDescription: String
        -createdBy: User
        -indexedAt: Instant
        -createdAt: Instant
    }

    class ImageBlob {
        <<Entity>>
        -id: Long
        -data: byte[]
        -mimeType: String
        -sizeBytes: Integer
        -user: User
        -createdAt: Instant
    }

    class ImageDraweTag {
        <<Entity>>
        -id: Long
        -image: Image
        -technique: String
        -subject: String
        -mood: String
        -utility: List~String~
        -freeTags: List~String~
        -taggedBy: String
        -taggedAt: Instant
    }

    class ImageFeedback {
        <<Entity>>
        -id: Long
        -user: User
        -image: Image
        -feedback: FeedbackType
        -createdAt: Instant
    }

    class ImageUploadResponse {
        <<DTO>>
        +imageId: Long
        +url: String
    }

    class FeedbackRequest {
        <<DTO>>
        +type: FeedbackType
    }

    class FeedbackResponse {
        <<DTO>>
        +type: FeedbackType
    }

    class AiImageCreatedEvent {
        <<DTO>>
        +imageId: Long
        +imageBytes: byte[]
        +mimeType: String
        +project: Project
    }

    class Stored {
        <<DTO>>
        +id: Long
        +url: String
    }

    class Loaded {
        <<DTO>>
        +id: Long
        +data: byte[]
        +mimeType: String
        +ownerId: Long
    }

    ImageController ..> ImageUploadService : uses
    ImageController ..> DbImageStorage : uses
    ImageController ..> ImageUploadResponse : creates
    ImageFeedbackController ..> ImageFeedbackService : uses
    ImageFeedbackController ..> FeedbackRequest : uses
    ImageFeedbackController ..> FeedbackResponse : uses

    ImageUploadService ..> ImageStorage : uses
    ImageStorage <|.. DbImageStorage : implements
    ImageStorage <|.. S3ImageStorage : implements
    ImageStorage +-- Stored
    ImageStorage +-- Loaded
    DbImageStorage ..> ImageBlobRepository : uses
    DbImageStorage ..> ImageBlob : creates
    S3ImageStorage ..> S3Properties : uses

    ImageUrlSigner ..> S3ImageStorage : uses
    ImageUrlSigner ..> S3Properties : uses

    ImageGenerationService ..> ImageStorage : uses
    ImageGenerationService ..> ImageRepository : uses
    ImageGenerationService ..> Image : creates
    ImageGenerationService ..> AiImageCreatedEvent : creates

    AiImageIndexService ..> AiImageCreatedEvent : uses
    AiImageIndexService ..> ImageRepository : uses
    AiImageIndexService ..> AiImageIndexTxService : uses
    AiImageIndexTxService ..> ImageRepository : uses
    AiImageIndexTxService ..> ImageDraweTagRepository : uses
    AiImageIndexTxService ..> ImageDraweTag : creates

    ImageFeedbackService ..> ImageFeedbackRepository : uses
    ImageFeedbackService ..> ImageRepository : uses
    ImageFeedbackService ..> ImageFeedback : creates
    ImageFeedbackService ..> FeedbackResponse : creates

    ImageRepository ..> Image : uses
    ImageBlobRepository ..> ImageBlob : uses
    ImageDraweTagRepository ..> ImageDraweTag : uses
    ImageFeedbackRepository ..> ImageFeedback : uses

    ImageBlob "1" --> "1" User : owner
    Image "1" --> "0..1" User : createdBy
    ImageDraweTag "1" --> "1" Image : image
    ImageFeedback "1" --> "1" User : user
    ImageFeedback "1" --> "1" Image : image
```

<br>

## ImageController 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageController | - | public | `/images` 이미지 업로드/서빙 REST 컨트롤러. 바이트 서빙(load)은 MySQL 전용이라 `DbImageStorage`를 직접 주입한다(s3 프로파일의 `@Primary` `S3ImageStorage.load`=throw 회피). |
| **Attributes** | imageUploadService | ImageUploadService | private | 업로드 검증/저장 위임 서비스 |
| **Attributes** | imageStorage | DbImageStorage | private | 바이트 서빙용 MySQL 스토리지(소유자 검증 포함) |
| **Operations** | upload | ApiResponse~ImageUploadResponse~ | public | 이미지 업로드 (POST /images/upload). 인증 사용자의 파일을 저장하고 `imageId`+`url` 반환 |
| **Operations** | view | ResponseEntity~byte[]~ | public | 이미지 서빙 (GET /images/{id}). 소유자 검증 후 바이트 반환. `download=true`면 `Content-Disposition: attachment`로 파일 다운로드 유도 |

<br>

## ImageFeedbackController 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageFeedbackController | - | public | `/images/{imageId}/feedback` 좋아요/싫어요 피드백 REST 컨트롤러 |
| **Attributes** | feedbackService | ImageFeedbackService | private | 피드백 조회/저장/삭제 위임 서비스 |
| **Operations** | getFeedback | ResponseEntity~ApiResponse~FeedbackResponse~~ | public | 피드백 조회 (GET /images/{imageId}/feedback). 없으면 `type=null` 반환 |
| **Operations** | saveFeedback | ResponseEntity~ApiResponse~Void~~ | public | 피드백 저장 (POST /images/{imageId}/feedback). 기존 있으면 갱신, 없으면 생성 (upsert) |
| **Operations** | removeFeedback | ResponseEntity~ApiResponse~Void~~ | public | 피드백 삭제 (DELETE /images/{imageId}/feedback) |

<br>

## ImageUploadService 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageUploadService | - | public | 업로드 파일 검증(비어있음/크기/MIME) 후 `ImageStorage`에 위임하는 서비스 |
| **Attributes** | ALLOWED_MIMES | Set~String~ | private static | 허용 MIME (image/jpeg, image/png, image/webp, image/gif) |
| **Attributes** | imageStorage | ImageStorage | private | 저장소 추상화(프로파일에 따라 Db 또는 S3) |
| **Attributes** | maxSizeBytes | long | private | 최대 허용 바이트 (`app.image.max-size-bytes`, 기본 10MB) |
| **Operations** | upload | ImageStorage.Stored | public | 검증 통과 시 바이트를 저장하고 `Stored(id, url)` 반환. 위반 시 `INVALID_INPUT`, IO 실패 시 `INTERNAL_SERVER_ERROR` |

<br>

## ImageFeedbackService 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageFeedbackService | - | public | 이미지 좋아요/싫어요 피드백 비즈니스 로직. (user, image) 유니크 제약 기반 upsert |
| **Attributes** | feedbackRepository | ImageFeedbackRepository | private | 피드백 영속화 |
| **Attributes** | imageRepository | ImageRepository | private | 대상 이미지 존재 검증 |
| **Operations** | saveFeedback | void | public | 기존 피드백 있으면 type 갱신, 없으면 신규 생성. 이미지 없으면 `NOT_FOUND` |
| **Operations** | removeFeedback | void | public | (user, image) 피드백 존재 시 삭제 |
| **Operations** | getFeedback | FeedbackResponse | public | 현재 사용자 피드백 조회. 없으면 `FeedbackResponse(null)` |

<br>

## ImageStorage 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageStorage | - | public | 이미지 저장소 추상화 인터페이스. 구현체: `DbImageStorage`(MySQL), `S3ImageStorage`(s3 프로파일). 향후 구현체만 교체 |
| **Operations** | store | Stored | public | 바이트+mime 저장 후 식별자/URL(`Stored`) 반환 |
| **Operations** | load | Loaded | public | 식별자로 이미지 조회(`Loaded`). 소유자 검증은 호출 측 책임 |

<br>

## DbImageStorage 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | DbImageStorage | - | public | `ImageStorage` MySQL 구현체. `image_blobs` 테이블에 BLOB 저장. 업로드 이미지·`/images/{id}` 서빙 경로 담당 |
| **Attributes** | imageBlobRepository | ImageBlobRepository | private | BLOB CRUD |
| **Operations** | store | Stored | public | `ImageBlob` 생성·저장 후 `Stored(id, "/images/" + id)` 반환 (@Transactional) |
| **Operations** | load | Loaded | public | id로 BLOB 조회, `Loaded(id, data, mimeType, ownerId)` 반환. 없으면 `NOT_FOUND` (@Transactional readOnly) |

<br>

## S3ImageStorage 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | S3ImageStorage | - | public | `ImageStorage` S3 구현체. `@Profile("s3")` + `@Primary`로 활성화. AI 이미지를 S3에 PUT하고 `Image.url`에 `s3:{key}` 접두로 저장(절대 URL/만료를 DB에 영구 저장하지 않음). 노출 직전 `ImageUrlSigner`가 presigned GET URL로 변환 |
| **Attributes** | S3_URL_PREFIX | String | public static | `Image.url`에 박히는 S3 키 접두 (`s3:`) |
| **Attributes** | DEFAULT_EXT | String | private static | 알 수 없는 mime의 기본 확장자 (png) |
| **Attributes** | s3Client | S3Client | private | AWS S3 SDK 동기 클라이언트 |
| **Attributes** | props | S3Properties | private | 버킷/키 prefix/presign TTL 설정 |
| **Operations** | store | Stored | public | UUID 키로 S3에 putObject 후 `Stored(null, "s3:" + key)` 반환. 실패 시 `AI_SERVICE_ERROR` (id 없음 → null) |
| **Operations** | load | Loaded | public | 미지원 — presigned 모델에선 서버가 바이트를 나르지 않음. `UnsupportedOperationException` throw |

<br>

## ImageUrlSigner 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageUrlSigner | - | public | DB BLOB(`/images/{id}`)을 브라우저 `<img>`로 직접 로드 가능하게 하는 단기 서명 발급/검증기. Authorization 헤더 없이 로드되는 AI 이미지의 401/403 깨짐(베타 P0-1) 해결. s3:{key}는 HMAC 대신 `S3Presigner`로 presign |
| **Attributes** | HMAC_ALGO | String | private static | 서명 알고리즘 (HmacSHA256) |
| **Attributes** | PATH_PREFIX | String | private static | 서명 대상 경로 접두 (`/images/`) |
| **Attributes** | key | SecretKeySpec | private | `jwt.secret`(BASE64) 재사용 HMAC 키 |
| **Attributes** | ttlSeconds | long | private | 서명 URL 만료 (`image.url.ttl-seconds`, 기본 3600) |
| **Attributes** | s3Presigner | S3Presigner | private | s3 프로파일에서만 존재(없으면 null), S3 presign 의존성 |
| **Attributes** | s3Properties | S3Properties | private | S3 버킷/presign TTL 설정 |
| **Operations** | sign | String | public | `s3:` 접두면 presigned GET URL, `/images/{id}`면 `?exp=&sig=` HMAC 서명 URL, 그 외(절대 URL 등)는 입력 그대로 반환 |
| **Operations** | verify | boolean | public | (id, exp, sig) 서명 검증. 만료/불일치면 false. 상수시간 비교 |

<br>

## AiImageIndexService 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | AiImageIndexService | - | public | AI 생성 이미지를 CLIP 임베딩 → Pinecone upsert까지 책임지는 비동기 인덱서. `ImageGenerationService.generate()` 커밋 후 발행된 `AiImageCreatedEvent`를 `@TransactionalEventListener(AFTER_COMMIT)`로 수신해 `@Async`로 인덱싱한다. 비동기 스레드가 새 TX에서 커밋된 행을 보장 조회. 흐름: `FastApiClient.embedImage`(임베딩) → `PineconeClient.upsert`(적재) → `AiImageIndexTxService.markIndexedAndSeedTag`(REQUIRES_NEW 별도 TX로 `indexed_at`/`is_tagged` 갱신 + `ImageDraweTag` 시드). 실패해도 사용자 응답은 끝났으므로 throw 없이 로그만 남겨 추후 재처리 대상으로 둔다 |
| **Attributes** | fastApiClient | FastApiClient | private | CLIP 이미지 임베딩 클라이언트 |
| **Attributes** | pineconeClient | PineconeClient | private | 벡터 upsert 클라이언트 |
| **Attributes** | imageRepository | ImageRepository | private | 인덱싱 대상 Image 조회 |
| **Attributes** | txService | AiImageIndexTxService | private | REQUIRES_NEW 트랜잭션 위임(자기 호출 프록시 회피) |
| **Operations** | onAiImageCreated | void | public | AFTER_COMMIT 단계 이벤트 수신 → `indexAsync` 트리거 |
| **Operations** | indexAsync | void | public | `@Async`. sourceId/미적재 가드 후 임베딩→upsert→마킹. 예외는 로그만 |

<br>

## AiImageIndexTxService 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | AiImageIndexTxService | - | (static nested) | `AiImageIndexService`의 트랜잭션 영역. 자기 호출 프록시 문제 회피용 분리 |
| **Attributes** | imageRepository | ImageRepository | private | indexed_at/is_tagged 갱신 |
| **Attributes** | imageDraweTagRepository | ImageDraweTagRepository | private | `ImageDraweTag` 시드 |
| **Operations** | markIndexedAndSeedTag | void | public | `@Transactional(REQUIRES_NEW)`. `indexed_at`·`isTagged=true` 설정 후, 기존 태그 없으면 project의 subject/technique/mood(30자 truncate)로 `ImageDraweTag`(taggedBy="AI") 시드 |

<br>

## ImageGenerationService 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageGenerationService | - | public | Bria로 이미지를 생성하고 결과 바이트를 `ImageStorage`에 영구 저장한 뒤 `Image` 엔티티를 만들어 반환. 임시 Bria URL은 즉시 다운로드해 우리 저장소로 옮긴다. (Bria 전체 흐름은 별도 문서) |
| **Attributes** | briaClient | BriaClient | private | Bria 이미지 생성 클라이언트 |
| **Attributes** | imageStorage | ImageStorage | private | 생성 바이트 저장 |
| **Attributes** | imageRepository | ImageRepository | private | Image 영속화 |
| **Attributes** | promptTranslator | PromptTranslator | private | 한국어 → 영문 프롬프트 변환 |
| **Attributes** | eventPublisher | ApplicationEventPublisher | private | `AiImageCreatedEvent` 발행 |
| **Attributes** | analyticsEventService | AnalyticsEventService | private | IMAGE_GENERATED 집계 이벤트 |
| **Attributes** | downloader | RestClient | private | Bria 임시 URL에서 바이트 다운로드 |
| **Operations** | generate | Image | public | 프롬프트 번역 → Bria 생성 → 바이트 다운로드 → 저장 → Image 저장(`sourceId="ai_<id>"`) → commit 후 `AiImageCreatedEvent` 발행(AFTER_COMMIT 비동기 인덱싱 트리거). @Transactional |

<br>

## ImageRepository 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageRepository | - | public | `JpaRepository<Image, Long>`. AI/Unsplash 이미지 메타 영속화 |
| **Operations** | findBySourceIdIn | List~Image~ | public | 여러 sourceId 이미지 일괄 조회(Pinecone 결과 → MySQL 매핑) |
| **Operations** | findByIsOnboardingTrue | List~Image~ | public | 온보딩 시드 이미지 조회 |
| **Operations** | findAllRawTagsJson | List~String~ | public | 태그 IDF 색인용 — 모든 raw_tags JSON 텍스트 스캔(native) |
| **Operations** | findAllPrompts | List~String~ | public | 태그 IDF 색인용 — AI 영문 프롬프트 스캔(native) |
| **Operations** | findCompletedGallery | Page~Image~ | public | 완성작 갤러리 — (source=AI, createdBy=user) 최신순(createdAt DESC, id DESC) 페이징 |

<br>

## ImageBlobRepository 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageBlobRepository | - | public | `JpaRepository<ImageBlob, Long>`. 업로드/AI 이미지 BLOB CRUD(기본 메서드만) |

<br>

## ImageDraweTagRepository 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageDraweTagRepository | - | public | `JpaRepository<ImageDraweTag, Long>`. DraWe 자체 태그(주제/기법/분위기) CRUD |
| **Operations** | findByImageIdIn | List~ImageDraweTag~ | public | 여러 imageId의 태그 일괄 조회 |

<br>

## ImageFeedbackRepository 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageFeedbackRepository | - | public | `JpaRepository<ImageFeedback, Long>`. 사용자별 이미지 피드백 CRUD |
| **Operations** | findByUserAndImage | Optional~ImageFeedback~ | public | (user, image) 유니크 기준 단건 조회(upsert/삭제용) |

<br>

## Image 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | Image | - | public | `images` 테이블 엔티티. Unsplash 시드 + AI 생성 이미지 메타데이터 |
| **Attributes** | id | Long | private | PK (IDENTITY) |
| **Attributes** | source | ImageSource | private | 출처 (UNSPLASH / AI) |
| **Attributes** | sourceId | String | private | 외부/내부 식별자. AI는 `ai_<id>`, Pinecone vector id로도 사용 |
| **Attributes** | url | String | private | 이미지 URL. AI(MySQL)는 `/images/{id}`, s3 프로파일은 `s3:{key}` |
| **Attributes** | embeddingId | String | private | 임베딩 식별자 |
| **Attributes** | photographerUsername | String | private | Unsplash 작가 username |
| **Attributes** | photographerName | String | private | Unsplash 작가 이름 |
| **Attributes** | isOnboarding | Boolean | private | 온보딩 시드 여부 (기본 false) |
| **Attributes** | isTagged | Boolean | private | DraWe 태그 부여 여부 (기본 false) |
| **Attributes** | rawTags | List~String~ | private | 원본 태그 JSON |
| **Attributes** | prompt | String | private | 외부 모델에 보낸 영문 프롬프트 (AI 전용) |
| **Attributes** | aiDescription | String | private | Unsplash AI 캡션(alt-text). Unsplash 전용 |
| **Attributes** | createdBy | User | private | AI 이미지 생성자 (FK, ON DELETE SET NULL) |
| **Attributes** | indexedAt | Instant | private | Pinecone 적재 완료 시각. NULL = 미적재 |
| **Attributes** | createdAt | Instant | private | 생성 시각 (@CreationTimestamp, 갤러리 정렬용) |

<br>

## ImageBlob 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageBlob | - | public | `image_blobs` 테이블 엔티티. 업로드/AI 이미지 바이트 저장(MVP 저장소). `ImageStorage` 추상화 뒤에 위치 |
| **Attributes** | id | Long | private | PK (IDENTITY) |
| **Attributes** | data | byte[] | private | 이미지 바이트 (MEDIUMBLOB, LAZY) |
| **Attributes** | mimeType | String | private | MIME 타입 (max 50) |
| **Attributes** | sizeBytes | Integer | private | 바이트 크기 |
| **Attributes** | user | User | private | 소유자 (FK, not null) |
| **Attributes** | createdAt | Instant | private | 생성 시각 (@CreationTimestamp) |

<br>

## ImageDraweTag 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageDraweTag | - | public | `image_drawe_tags` 테이블 엔티티. DraWe 자체 태깅(주제/기법/분위기). Image와 `@MapsId` 1:1 공유 PK |
| **Attributes** | id | Long | private | PK = image_id (`@MapsId`) |
| **Attributes** | image | Image | private | 대상 이미지 (1:1) |
| **Attributes** | technique | String | private | 기법 태그 (max 30, 인덱스) |
| **Attributes** | subject | String | private | 주제 태그 (max 30, 인덱스) |
| **Attributes** | mood | String | private | 분위기 태그 (max 30, 인덱스) |
| **Attributes** | utility | List~String~ | private | 활용 태그 JSON |
| **Attributes** | freeTags | List~String~ | private | 자유 태그 JSON |
| **Attributes** | taggedBy | String | private | 태그 부여 주체 (예: "AI", max 20) |
| **Attributes** | taggedAt | Instant | private | 태그 부여 시각 |

<br>

## ImageFeedback 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageFeedback | - | public | `image_feedback` 테이블 엔티티. (user_id, image_id) 유니크 — 사용자당 이미지 1개 피드백 |
| **Attributes** | id | Long | private | PK (IDENTITY) |
| **Attributes** | user | User | private | 피드백 사용자 (FK, not null) |
| **Attributes** | image | Image | private | 대상 이미지 (FK, not null) |
| **Attributes** | feedback | FeedbackType | private | 피드백 타입 (LIKE / DISLIKE) |
| **Attributes** | createdAt | Instant | private | 생성 시각 (@CreationTimestamp) |

<br>

## ImageUploadResponse 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | ImageUploadResponse | record | public | 업로드 응답 DTO |
| **Attributes** | imageId | Long | public | 저장된 이미지 식별자 |
| **Attributes** | url | String | public | 서빙 URL (`/images/{id}`) |

<br>

## FeedbackRequest 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | FeedbackRequest | record | public | 피드백 저장 요청 DTO |
| **Attributes** | type | FeedbackType | public | 피드백 타입 (@NotNull, LIKE/DISLIKE) |

<br>

## FeedbackResponse 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | FeedbackResponse | record | public | 피드백 조회 응답 DTO |
| **Attributes** | type | FeedbackType | public | 현재 피드백. null이면 피드백 없음 |

<br>

## AiImageCreatedEvent 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | AiImageCreatedEvent | record | public | AI 이미지가 MySQL에 저장된 직후 발행되는 이벤트. `ImageGenerationService.generate()` 커밋 후 `AiImageIndexService`가 AFTER_COMMIT에서 수신 → CLIP 임베딩 + Pinecone upsert |
| **Attributes** | imageId | Long | public | 저장된 Image의 id |
| **Attributes** | imageBytes | byte[] | public | 임베딩 대상 이미지 바이트 |
| **Attributes** | mimeType | String | public | 이미지 MIME |
| **Attributes** | project | Project | public | 메타데이터(subject/technique/mood) 상속용 프로젝트 |

<br>

## Stored 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | Stored | record | public | `ImageStorage.store()` 반환 — 저장 결과. (Db: id 채움, S3: id=null) |
| **Attributes** | id | Long | public | 저장 식별자 (S3는 null) |
| **Attributes** | url | String | public | 저장 URL (`/images/{id}` 또는 `s3:{key}`) |

<br>

## Loaded 클래스 정보

| 구분 | Name | Type | Visibility | Description |
|------|------|------|------------|-------------|
| **class** | Loaded | record | public | `ImageStorage.load()` 반환 — 조회 결과(바이트 포함). DbImageStorage 전용 |
| **Attributes** | id | Long | public | 이미지 식별자 |
| **Attributes** | data | byte[] | public | 이미지 바이트 |
| **Attributes** | mimeType | String | public | MIME 타입 |
| **Attributes** | ownerId | Long | public | 소유자 user id (컨트롤러 소유자 검증용) |
