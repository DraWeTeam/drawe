-- SCRUM-115: 프로젝트 생성 UI 변경(주제 입력 → 키워드 추출/편집).
-- 추출된 키워드 리스트를 저장할 JSON 컬럼 추가. subject/technique/mood 는 키워드에서 백그라운드 분류해 채운다.
ALTER TABLE projects ADD COLUMN keywords JSON NULL;
