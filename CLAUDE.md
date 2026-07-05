# 작업 규칙 (묻지 말고 이 기준대로)

## 커밋·배포
- 커밋: 한 커밋 = 한 논리. 검증(빌드 + eslint/prettier + 가능하면 실렌더) 통과 시 **승인 없이 커밋 진행**.
- push · PR · terraform apply · kubectl/argocd 배포: **항상 사용자 승인 필요**(묻는 게 맞음). 기본 push 0.

## 데이터(DB)
- INSERT는 자유(★UTF-8 명시. Korean 리터럴은 셸 미경유 — INSERT...SELECT나 파일 경유로 cp949 오염 방지).
- UPDATE · DELETE · id 임계 삭제: **항상 승인 필요**(drift 위험).

## 화면 작업 선행 참조
- 화면(SCR-*) 구현·수정 전, `docs/figma-spec-compendium.md`에서 해당 섹션 스펙(화면 목적·[상태]/[동작]/[연동]·정본 표/매트릭스)을 **먼저 확인**한다. Figma 정본과 코드가 어긋나면 정본 우선, 전제 불일치는 보고. (원본: Figma UX-UI-Wireframe, fileKey `vEWEwSklFvrk1wOzhtHsOX`.)

## 경계
- 그쪽 영역(board/reference·SCRUM-113 코드, backend): 내용 변경 전 보고. 이동·import·읽기는 자유.
- `ChatPage.jsx` / `ChatPage.module.css`: 수정 전 반드시 보고(Fidelity 밀집 파일). read-only import는 무방.
- 골든셋·정확도·contract·프롬프트·vision.py·llm.py(Grok): 지시 없이 미접촉.

## 판단
- 사소한 선택(변수명·파일 위치·구현 세부·아이콘 SVG 등)은 **묻지 말고 관례대로 진행 후 리포트에 기록**.
- 옵션이 갈리면 지시어의 기본 선택지대로 진행하고 사유를 리포트에 명시(없으면 가장 안전·최소변경 쪽).
- ★**멈추고 보고할 때**(이건 유지): 전제가 코드와 불일치 / 검증 실패·불가 / 되돌리기 어려운 행위 /
  값 변경(move-only 위반) 발견 / 데이터·push·apply 등 승인 필요 행위.

## 토큰·자격증명
- 검수용 dev JWT는 대화 컨텍스트에서만 유지·사용. **커밋·리포트·로그·메모리 파일에 값 미기록**.
- refreshToken은 장기 자격 — 개발 국면 종료(PR 머지)쯤 정리.

## 검증
- 프론트: eslint + prettier --check + build. 실렌더는 headless Chrome + 토큰 주입(OAuth 우회).
- fastapi: ruff check + ruff format --check. terraform: fmt -check + validate(-backend=false).
