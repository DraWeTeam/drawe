# 7. Sequence Diagram

도메인별로 핵심 흐름을 시퀀스 다이어그램으로 정리한다(GameMatch 방식). 각 문서는 **상세 mermaid sequenceDiagram**(Controller → Service → Repository → DB, 실제 메서드·파라미터, `alt`/`opt` 분기, 반환)과 **흐름 요약 표**(항목/흐름 요약/핵심 비즈니스 로직)를 담는다.

> **⭐ = 핵심 기능**.

| 도메인 | 문서 | 포함 흐름 |
|---|---|---|
| **채팅 (LLM)** | [chatSequenceDiagram](./sequenceDiagram/chatSequenceDiagram.md) | ⭐ NEW_SEARCH(레퍼런스 검색) · KEEP/FOLLOWUP(재사용) · COMPOSE 종착 의도(조언·비교·거절·SKIP) · SELF_CRITIQUE(자기비평) · GENERATE(이미지 생성) · 대화 초기화 |
| **이미지 가이드** | [guideSequenceDiagram](./sequenceDiagram/guideSequenceDiagram.md) | ⭐ 그림 업로드 진단·코칭 · 가이드 피드백·레퍼런스 채택 |
| **인증** | [authSequenceDiagram](./sequenceDiagram/authSequenceDiagram.md) | 이메일 회원가입 · 이메일 로그인 · Google OAuth2 · 토큰 갱신(rotation) |
| **프로젝트 · 핀** | [projectSequenceDiagram](./sequenceDiagram/projectSequenceDiagram.md) | 생성·수정 · 목록(QueryDSL 정렬·검색·필터) · 핀 추가 · 삭제(cascade) |
| **이미지** | [imageSequenceDiagram](./sequenceDiagram/imageSequenceDiagram.md) | 업로드·서빙 · 좋아요/싫어요 피드백 |
| **갤러리 · 아카이브** | [gallerySequenceDiagram](./sequenceDiagram/gallerySequenceDiagram.md) | 완성작 갤러리(AI 생성) · 레퍼런스 아카이브 |

> 채팅 도메인의 의도 라우팅 정본은 [aiPipelineDesign §5.2.1](./aiPipelineDesign.md), 의도별 단계 매핑은 [classDiagram §chatPipeline](./classDiagram/chatPipelineClassDiagram.md) 참고.
