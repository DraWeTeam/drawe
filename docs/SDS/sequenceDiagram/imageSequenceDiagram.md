# 이미지 시퀀스 다이어그램

이미지 업로드·서빙(저장 추상화)과 좋아요/싫어요 피드백.


## 이미지 업로드 (Image Upload) Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant ImageController
    participant ImageUploadService
    participant ImageStorage as "ImageStorage (interface)"
    participant DbImageStorage as "DbImageStorage (default)"
    participant S3 as "S3ImageStorage (@Profile s3)"
    participant DB as "ImageBlobRepository / MySQL"

    Client->>ImageController: POST /images/upload<br/>(@RequestParam("file") MultipartFile, @AuthenticationPrincipal)
    ImageController->>ImageUploadService: upload(principal.getUser(), file)

    Note over ImageUploadService: 검증: 빈 파일 / 크기(maxSizeBytes=10485760) / MIME(ALLOWED_MIMES)

    alt file == null || file.isEmpty()
        ImageUploadService-->>ImageController: throw CustomException(ErrorCode.INVALID_INPUT)
        ImageController-->>Client: 400 INVALID_INPUT
    else file.getSize() > maxSizeBytes
        ImageUploadService-->>ImageController: throw CustomException(ErrorCode.INVALID_INPUT)
        ImageController-->>Client: 400 INVALID_INPUT (크기 초과)
    else mime == null || !ALLOWED_MIMES.contains(mime)
        Note over ImageUploadService: ALLOWED_MIMES = {image/jpeg, image/png, image/webp, image/gif}
        ImageUploadService-->>ImageController: throw CustomException(ErrorCode.INVALID_INPUT)
        ImageController-->>Client: 400 INVALID_INPUT (지원하지 않는 형식)
    else 검증 통과
        Note over ImageUploadService: file.getBytes() (IOException 시 INTERNAL_SERVER_ERROR)
        ImageUploadService->>ImageStorage: store(owner, file.getBytes(), mime)

        alt 기본 프로파일 (DB 저장)
            ImageStorage->>DbImageStorage: store(owner, data, mimeType)
            DbImageStorage->>DB: imageBlobRepository.save(ImageBlob{user, data, mimeType, sizeBytes})
            DB-->>DbImageStorage: saved (id)
            DbImageStorage-->>ImageUploadService: Stored(saved.getId(), "/images/{id}")
        else s3 프로파일 (@Primary S3ImageStorage)
            ImageStorage->>S3: store(owner, data, mimeType)
            Note over S3: key = keyPrefix/UUID.확장자
            S3->>S3: s3Client.putObject(bucket, key, ...)<br/>(S3Exception → AI_SERVICE_ERROR)
            S3-->>ImageUploadService: Stored(null, "s3:{key}")
        end

        ImageUploadService-->>ImageController: ImageStorage.Stored{id, url}
    end

    ImageController-->>Client: 200 OK (ApiResponse<ImageUploadResponse>: imageId, url)

    Note over Client,DB: 서빙은 별도 — GET /images/{id} (DbImageStorage.load + 소유자 검증).<br/>응답 url 은 노출 직전 ImageUrlSigner.sign() 이 서명/presigned URL 로 변환.<br/>DB blob → /images/{id}?exp=&sig=HMAC-SHA256, s3:{key} → S3 presigned GET URL.
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
| --- | --- | --- |
| 목표 | 인증 사용자가 채팅용 이미지를 업로드하고 저장 식별자/URL 을 돌려받는다 | `POST /images/upload` → `ImageController.upload(principal, MultipartFile)` → `ImageUploadService.upload(user, file)` |
| 검증 (MIME/크기) | 빈 파일·크기 초과·미지원 MIME 을 업로드 전에 차단 | `ALLOWED_MIMES = {image/jpeg, image/png, image/webp, image/gif}`, `maxSizeBytes`(기본 10485760, `app.image.max-size-bytes`) 초과 또는 미지원 형식 시 `CustomException(ErrorCode.INVALID_INPUT)`; `file.getBytes()` IOException 시 `INTERNAL_SERVER_ERROR` |
| 저장 (DB/S3 추상화) | `ImageStorage` 인터페이스로 백엔드 추상화, 프로파일로 구현 교체 | 기본: `DbImageStorage.store` → `ImageBlobRepository.save(ImageBlob)` → `Stored(id, "/images/{id}")`. `s3` 프로파일(@Primary `S3ImageStorage`): `s3Client.putObject` → `Stored(null, "s3:{key}")`, 실패 시 `AI_SERVICE_ERROR` |
| URL 반환 | 저장 결과를 응답 DTO 로 매핑 | `Stored{id, url}` → `new ImageUploadResponse(stored.id(), stored.url())` |
| 서빙 (서명 URL) | 저장 경로 자체는 영구 보관, 노출 직전에만 단기 서명 | `GET /images/{id}` 는 `DbImageStorage.load` + 소유자 검증(MySQL 전용). 응답 url 은 `ImageUrlSigner.sign()` 이 변환 — DB blob 은 `/images/{id}?exp=&sig=HMAC-SHA256`, `s3:{key}` 는 `S3Presigner` presigned GET URL |
| 응답 | 표준 래퍼로 imageId·url 반환 | `200 OK` `ApiResponse.success(ImageUploadResponse{imageId, url})` |

## 이미지 피드백 (좋아요/싫어요) Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant ImageFeedbackController
    participant ImageFeedbackService
    participant ImageRepository
    participant ImageFeedbackRepository
    participant DB as "MySQL (image / image_feedback)"

    Note over Client,DB: image_feedback 테이블은 (user_id, image_id) UNIQUE 제약 — 사용자·이미지당 피드백 1건.

    %% ── POST: 피드백 저장 (upsert) ──────────────────────────────
    rect rgb(235, 245, 255)
        Note over Client,DB: ① 피드백 저장 (LIKE / DISLIKE) — upsert
        Client->>ImageFeedbackController: POST /images/{imageId}/feedback<br/>(@AuthenticationPrincipal, @Valid FeedbackRequest{type})
        ImageFeedbackController->>ImageFeedbackService: saveFeedback(principal.getUser(), imageId, request.type())

        ImageFeedbackService->>ImageRepository: findById(imageId)
        ImageRepository->>DB: SELECT * FROM image WHERE id = ?
        DB-->>ImageRepository: Optional<Image>

        alt 이미지 없음 (Optional.empty)
            ImageFeedbackService-->>ImageFeedbackController: throw CustomException(ErrorCode.NOT_FOUND)
            ImageFeedbackController-->>Client: 404 NOT_FOUND
        else 이미지 존재
            ImageFeedbackService->>ImageFeedbackRepository: findByUserAndImage(user, image)
            ImageFeedbackRepository->>DB: SELECT * FROM image_feedback WHERE user_id = ? AND image_id = ?
            DB-->>ImageFeedbackRepository: Optional<ImageFeedback>

            alt 기존 피드백 존재 (업데이트)
                Note over ImageFeedbackService: feedback.setFeedback(type) — 기존 row 의 feedback 컬럼만 교체
                ImageFeedbackService->>ImageFeedbackRepository: save(feedback)
                ImageFeedbackRepository->>DB: UPDATE image_feedback SET feedback = ? WHERE id = ?
            else 피드백 없음 (신규 생성)
                Note over ImageFeedbackService: orElseGet → new ImageFeedback()<br/>setUser(user), setImage(image), setFeedback(type)
                ImageFeedbackService->>ImageFeedbackRepository: save(feedback)
                ImageFeedbackRepository->>DB: INSERT INTO image_feedback (user_id, image_id, feedback, created_at)
                Note over DB: UNIQUE(user_id, image_id) 위반 시 INSERT 실패
            end

            DB-->>ImageFeedbackRepository: saved
            ImageFeedbackService-->>ImageFeedbackController: void (log.info "피드백 저장")
            ImageFeedbackController-->>Client: 200 OK (ApiResponse<Void>: success(null))
        end
    end

    %% ── GET: 피드백 조회 ────────────────────────────────────────
    rect rgb(235, 255, 240)
        Note over Client,DB: ② 피드백 조회
        Client->>ImageFeedbackController: GET /images/{imageId}/feedback<br/>(@AuthenticationPrincipal)
        ImageFeedbackController->>ImageFeedbackService: getFeedback(principal.getUser(), imageId)

        ImageFeedbackService->>ImageRepository: findById(imageId)
        ImageRepository->>DB: SELECT * FROM image WHERE id = ?
        DB-->>ImageRepository: Optional<Image>

        alt 이미지 없음
            ImageFeedbackService-->>ImageFeedbackController: throw CustomException(ErrorCode.NOT_FOUND)
            ImageFeedbackController-->>Client: 404 NOT_FOUND
        else 이미지 존재
            ImageFeedbackService->>ImageFeedbackRepository: findByUserAndImage(user, image)
            ImageFeedbackRepository->>DB: SELECT * FROM image_feedback WHERE user_id = ? AND image_id = ?
            DB-->>ImageFeedbackRepository: Optional<ImageFeedback>
            Note over ImageFeedbackService: .map(f -> new FeedbackResponse(f.getFeedback()))<br/>.orElse(new FeedbackResponse(null)) — 피드백 없으면 type = null
            ImageFeedbackService-->>ImageFeedbackController: FeedbackResponse(type 또는 null)
            ImageFeedbackController-->>Client: 200 OK (ApiResponse<FeedbackResponse>: { type })
        end
    end

    %% ── DELETE: 피드백 삭제 ─────────────────────────────────────
    rect rgb(255, 240, 240)
        Note over Client,DB: ③ 피드백 삭제 (없으면 no-op)
        Client->>ImageFeedbackController: DELETE /images/{imageId}/feedback<br/>(@AuthenticationPrincipal)
        ImageFeedbackController->>ImageFeedbackService: removeFeedback(principal.getUser(), imageId)

        ImageFeedbackService->>ImageRepository: findById(imageId)
        ImageRepository->>DB: SELECT * FROM image WHERE id = ?
        DB-->>ImageRepository: Optional<Image>

        alt 이미지 없음
            ImageFeedbackService-->>ImageFeedbackController: throw CustomException(ErrorCode.NOT_FOUND)
            ImageFeedbackController-->>Client: 404 NOT_FOUND
        else 이미지 존재
            ImageFeedbackService->>ImageFeedbackRepository: findByUserAndImage(user, image)
            ImageFeedbackRepository->>DB: SELECT * FROM image_feedback WHERE user_id = ? AND image_id = ?
            DB-->>ImageFeedbackRepository: Optional<ImageFeedback>
            Note over ImageFeedbackService: .ifPresent(feedbackRepository::delete) — 있을 때만 삭제, 없으면 no-op
            opt 피드백 존재
                ImageFeedbackService->>ImageFeedbackRepository: delete(feedback)
                ImageFeedbackRepository->>DB: DELETE FROM image_feedback WHERE id = ?
            end
            ImageFeedbackService-->>ImageFeedbackController: void (log.info "피드백 제거")
            ImageFeedbackController-->>Client: 200 OK (ApiResponse<Void>: success(null))
        end
    end
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
| --- | --- | --- |
| 목표 | 인증 사용자가 특정 이미지에 좋아요/싫어요를 남기고 조회·삭제한다 | `/images/{imageId}/feedback` 의 `POST`/`GET`/`DELETE` → `ImageFeedbackController` → `ImageFeedbackService`. `FeedbackType` 은 `LIKE`/`DISLIKE` 2종 |
| 피드백 저장 (upsert) | `POST` 로 LIKE/DISLIKE 저장, 기존 피드백은 덮어쓰기 | `saveFeedback(user, imageId, type)`: `imageRepository.findById` → 없으면 `CustomException(ErrorCode.NOT_FOUND)`. `feedbackRepository.findByUserAndImage(user, image)` → 있으면 `setFeedback(type)`(UPDATE), 없으면 `orElseGet`으로 `new ImageFeedback` 생성 후 `setUser`/`setImage`/`setFeedback`(INSERT) → `save` |
| 조회 | `GET` 으로 현재 사용자의 피드백 상태 반환 | `getFeedback(user, imageId)`(`@Transactional(readOnly = true)`): `findByUserAndImage`.`map(f -> new FeedbackResponse(f.getFeedback()))`.`orElse(new FeedbackResponse(null))` — 피드백 없으면 `type = null` |
| 삭제 | `DELETE` 로 피드백 제거, 없으면 무동작 | `removeFeedback(user, imageId)`: `findByUserAndImage(user, image)`.`ifPresent(feedbackRepository::delete)` — 존재할 때만 삭제하고 없으면 no-op (예외 없음) |
| UNIQUE 제약 | 사용자·이미지당 피드백은 1건만 존재 | `ImageFeedback` `@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "image_id"}))`. `findByUserAndImage` 단건 조회 + upsert 로직이 이 제약을 보장 |
| 응답 | 표준 래퍼로 반환 | 저장/삭제: `200 OK` `ApiResponse<Void>`(`success(null)`). 조회: `200 OK` `ApiResponse<FeedbackResponse>`(`{ type }`, 미설정 시 `type = null`). 이미지 미존재 시 `ErrorCode.NOT_FOUND` |
