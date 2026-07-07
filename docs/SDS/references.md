# 12. References

## 모델 · 라이브러리
- **CLIP** (라이브: OpenCLIP ViT-L/14, 768-dim) — Radford et al., *Learning Transferable Visual Models From Natural Language Supervision* (OpenAI). 이미지·텍스트 공통 임베딩.
- **Komoran** — 한국어 형태소 분석기.
- **mediapipe** — 포즈 추정(가이드 비전).
- **Grok / Claude** — LLM provider(prod: 코칭=Grok, PAID compose=Claude). **Gemini** — dev/local VLM·생성 백엔드(`VLM_BACKEND=aistudio`).
- **Bedrock Stability** — 이미지 생성 API.

## 인프라 · 프레임워크
- **Spring Boot 3.2 / Spring Data JPA / Spring Security**
- **QueryDSL** — 타입 안전 동적 쿼리.
- **Flyway** — 스키마 마이그레이션.
- **Resilience4j** — 서킷브레이커·리트라이.
- **Pinecone** — 벡터 검색 DB(채팅 추천).
- **Qdrant** — 벡터 검색 DB(가이드 레퍼런스).
- **AWS EKS · ArgoCD(GitOps) · Karpenter / ALB, Cloudflare** — 배포·엣지.

## 내부 문서
- `docs/SDS/` — 본 설계 문서 세트.
- 데이터셋: Unsplash Research Dataset Lite (이미지·키워드).