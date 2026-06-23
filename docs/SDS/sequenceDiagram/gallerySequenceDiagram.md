# 갤러리 · 아카이브 시퀀스 다이어그램

완성작 갤러리(AI 생성)와 프로젝트별 레퍼런스 아카이브(읽기 전용).


## 갤러리 · 레퍼런스 아카이브 조회 Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant GalleryController
    participant GalleryService
    participant ImageRepository
    participant ProjectReferenceRepository
    participant DB as MySQL(DB)

    Note over Client,DB: 두 엔드포인트 모두 GET 전용 · 읽기 전용(@Transactional(readOnly=true)) — 레퍼런스 추가/삭제 없음

    %% ===== 1) 완성작 갤러리 =====
    rect rgb(235, 245, 255)
        Note over Client,DB: [1] 완성작 갤러리 조회 — 내가 만든 AI 이미지 최신순 페이징
        Client->>GalleryController: GET /gallery/completed?page=0&size=20
        Note right of GalleryController: @AuthenticationPrincipal PrincipalDetails<br/>@Min(0) page, @Min(1) @Max(100) size
        GalleryController->>GalleryService: getCompleted(principal.getUser(), page, size)
        GalleryService->>ImageRepository: findCompletedGallery(ImageSource.AI, user, PageRequest.of(page, size))
        ImageRepository->>DB: SELECT i FROM Image i<br/>WHERE i.source = :source AND i.createdBy = :createdBy<br/>ORDER BY i.createdAt DESC, i.id DESC (+ count)
        Note right of DB: source=AI AND createdBy=user<br/>최신순(createdAt DESC, id DESC) 페이징
        DB-->>ImageRepository: Page<Image> (content + totalElements + hasNext)
        ImageRepository-->>GalleryService: Page<Image> result
        GalleryService->>GalleryService: result.getContent().stream().map(GalleryItem::of).toList()<br/>hasMore = result.hasNext()
        GalleryService-->>GalleryController: new GalleryResponse(items, result.getTotalElements(), hasMore)
        GalleryController-->>Client: ApiResponse.success(GalleryResponse{items, total, hasMore})
    end

    %% ===== 2) 레퍼런스 아카이브 =====
    rect rgb(240, 255, 240)
        Note over Client,DB: [2] 레퍼런스 아카이브 조회 — 내 프로젝트별 레퍼런스 섹션
        Client->>GalleryController: GET /gallery/references
        Note right of GalleryController: @AuthenticationPrincipal PrincipalDetails
        GalleryController->>GalleryService: getReferenceArchive(principal.getUser())
        GalleryService->>ProjectReferenceRepository: findAllByUserWithImage(user)
        ProjectReferenceRepository->>DB: SELECT pr FROM ProjectReference pr<br/>JOIN FETCH pr.image JOIN FETCH pr.project p<br/>WHERE p.user = :user<br/>ORDER BY p.id DESC, pr.addedAt DESC
        Note right of DB: JOIN FETCH image+project (N+1 방지) · 단일 쿼리<br/>project.id DESC, addedAt DESC 정렬
        DB-->>ProjectReferenceRepository: List<ProjectReference> (image·project 즉시 로딩)
        ProjectReferenceRepository-->>GalleryService: List<ProjectReference> refs
        GalleryService->>GalleryService: LinkedHashMap<Long, ProjectSection><br/>computeIfAbsent(project.getId(), ...) 으로 프로젝트별 그룹핑<br/>(정렬 순서 보존) · references.add(new ReferenceImageItem(image.getId(), image.getUrl()))
        GalleryService-->>GalleryController: new ReferenceArchiveResponse(new ArrayList<>(sections.values()))
        GalleryController-->>Client: ApiResponse.success(ReferenceArchiveResponse{sections: ProjectSection[]})
    end
```

---

| 항목 | 흐름 요약 | 핵심 비즈니스 로직 |
| --- | --- | --- |
| 목표 | 로그인 유저의 AI 완성작 갤러리와 프로젝트별 레퍼런스 아카이브를 조회한다. 둘 다 `GET`·읽기 전용으로, 추가/삭제 부수효과가 없다. | `@Transactional(readOnly = true)` 보장. `@AuthenticationPrincipal` 로 본인 데이터만 노출. |
| 완성작 갤러리 (AI·페이지) | `GET /gallery/completed?page&size` → `getCompleted(user, page, size)` → `imageRepository.findCompletedGallery(ImageSource.AI, user, PageRequest.of(page, size))`. | `source=AI AND createdBy=user` 조건, `ORDER BY createdAt DESC, id DESC` 최신순 페이징. `page`(≥0)·`size`(1~100) 검증. |
| 레퍼런스 아카이브 (프로젝트별 그룹핑) | `GET /gallery/references` → `getReferenceArchive(user)` → `projectReferenceRepository.findAllByUserWithImage(user)` 결과를 프로젝트별 섹션으로 묶음. | `LinkedHashMap<Long, ProjectSection>` + `computeIfAbsent(project.id, ...)` 로 쿼리 정렬 순서(project.id DESC, addedAt DESC) 보존하며 그룹핑. |
| N+1 방지 (JOIN FETCH) | 레퍼런스 조회 시 `JOIN FETCH pr.image`, `JOIN FETCH pr.project p` 로 연관 엔티티를 단일 쿼리에 즉시 로딩. | 그룹핑 단계에서 `ref.getProject()` / `ref.getImage()` 접근 시 추가 쿼리가 발생하지 않아 N+1 문제 회피. |
| 응답 | 완성작: `GalleryResponse{items, total, hasMore}` (`hasMore = result.hasNext()`). 아카이브: `ReferenceArchiveResponse{sections: ProjectSection{projectId, projectName, references[ReferenceImageItem{imageId, url}]}}`. | 모두 `ApiResponse.success(...)` 로 래핑해 반환. |
