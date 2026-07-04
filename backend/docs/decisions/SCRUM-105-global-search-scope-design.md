# SCRUM-105 — 전역 검색 대상 확장 (전체 / 프로젝트 / 레퍼런스 / 완성작 갤러리)

## 1. 배경

좌측 사이드바의 **전역 검색 모달**(`frontend/src/template/SearchModal.jsx`)은 커맨드 팔레트 스타일로
사용자 본인의 콘텐츠를 이름/키워드로 찾아 이동하는 기능이다. 목업 메모: *"검색 기능은 전반적인 서비스 내의 모든
기능에 대한 검색이 가능하도록 함"*.

현재 한계:

- 필터 칩은 `전체 / 프로젝트 / 아카이브(disabled)` 만 있고, `filter` 상태는 저장만 되고 **API 에 안 보낸다**.
- 칩과 무관하게 항상 `GET /projects?q=` 만 호출하고(=프로젝트 이름 검색만), 결과로 프로젝트 이름만 렌더한다.

목표: 검색 대상을 **전체 / 프로젝트 / 레퍼런스 / 완성작 갤러리** 4종으로 확장한다.

> 주의: 이 검색은 **엔티티(콘텐츠) 텍스트 검색**이다. 챗의 `POST /search/images`(CLIP·Pinecone 의미검색)와는
> 별개 경로·별개 목적이다. 혼동 금지.

## 2. 대상별 데이터 매핑

| scope | 데이터 출처 | 키워드 매칭 대상 | 반환 항목 |
|---|---|---|---|
| `PROJECT` | `Project` (내 것) | name / subject / technique / mood 부분일치 | `{id, name, technique, status, updatedAt}` |
| `REFERENCE` | `ProjectReference` → `Image` (+`ImageDraweTag`) | **소속 프로젝트** name/subject/technique/mood + **이미지 태그** subject/technique/mood | `{imageId, url, projectId, projectName}` |
| `COMPLETED` | `Project` (status=COMPLETED, drawingUrl≠null) | name / subject / technique / mood 부분일치 | `{projectId, projectName, drawingUrl, completedAt}` |
| `ALL` | 위 3개 | 각 타입 규칙 | 3그룹 합본 (타입별 cap) |

레퍼런스는 고유 이름이 없으므로(스톡 이미지) **소속 프로젝트 맥락 + 이미지 태그**를 키워드로 삼는다.
예: "고양이" 검색 → 고양이 프로젝트에 핀한 레퍼런스가 잡힌다.

## 3. API

```
GET /search?q={keyword}&scope=ALL|PROJECT|REFERENCE|COMPLETED&limit=10
```

응답(`GlobalSearchResponse`):

```json
{
  "projects":   [{ "id":1, "name":"고양이 프로젝트", "technique":"수채화", "status":"in_progress", "updatedAt":"..." }],
  "references": [{ "imageId":12, "url":"https://...", "projectId":1, "projectName":"고양이 프로젝트" }],
  "completed":  [{ "projectId":3, "projectName":"손 그리기", "drawingUrl":"/images/9", "completedAt":"..." }]
}
```

- 선택 scope 의 그룹만 채우고 나머지는 빈 배열(`@JsonInclude ALWAYS`).
- `scope=ALL` 은 타입별 `ALL_PER_TYPE`(=5) 로 제한, 특정 scope 는 `limit`(기본 10, 상한 50).
- `q` 가 비면 빈 결과(퀵액션/최근검색어는 프론트가 처리).
- scope 파싱은 관대하게(대소문자 무시, 잘못된 값 → ALL) 처리해 400 을 피한다.

## 4. 구현

### 백엔드

- `domain/enums/SearchScope.java` — `ALL/PROJECT/REFERENCE/COMPLETED` + 관대 파서 `from(String)`.
- `domain/search/dto/GlobalSearchResponse.java` — 3그룹 record(중첩 hit record).
- `ProjectRepository.searchCompleted(user, status, kw, pageable)` — 완성작+키워드.
- `ProjectReferenceRepository.searchByKeyword(user, kw, pageable)` — 레퍼런스(프로젝트필드+태그) 키워드.
  - `ImageDraweTag` 는 `Image` 와 `@MapsId` 1:1 → `LEFT JOIN ImageDraweTag t ON t.image = i` 로 ad-hoc 조인(중복행 없음).
- `domain/search/service/GlobalSearchService` — scope 분기 + 매핑.
- `domain/search/controlller/GlobalSearchController` — `GET /search`.
  - `PROJECT` 은 기존 `ProjectRepositoryCustom.findPage` **재사용**(코드/시맨틱 일관).

### 프론트엔드

- `pages/search/api.js` — `globalSearch({q, scope, limit})` → `GET /search`.
- `template/SearchModal.jsx`
  - `FILTERS` → `전체/프로젝트/레퍼런스/완성작 갤러리`.
  - 디바운스 검색을 `globalSearch` 로 교체, `filter` 변경 시에도 재검색.
  - 결과를 그룹별 섹션으로 렌더: 프로젝트=폴더아이콘+이름, 레퍼런스/완성작=썸네일+프로젝트명.
  - 이동: 프로젝트 → `/projects/{id}/chat`, 레퍼런스 → `/archive`, 완성작 → `/gallery`.
  - 최근 검색어 `type` 을 scope 로 저장.
- `template/SearchModal.module.css` — 썸네일(`.thumb`) 스타일.

## 5. 비범위(후속 가능)

- 레퍼런스 `freeTags`/`rawTags`(JSON 컬렉션) 매칭 — v1 은 scalar 태그(subject/technique/mood)만.
- 서버측 최근검색어/인기검색어(현재 프론트 localStorage).
- 완성작 의미검색(현재 텍스트만).
