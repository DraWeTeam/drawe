-- 가이드 §4 추천 레퍼런스(FastAPI 코퍼스, UUID)를 아카이브로 인제스트할 때
-- ImageSource.GUIDE_REF 로 Image 를 INSERT 한다. images.source ENUM 이 ('UNSPLASH','AI')
-- 까지만 허용해 GUIDE_REF INSERT 시 MySQL Error 1265 (Data truncated for column 'source') 발생.
-- 이 migration 이 'GUIDE_REF' 를 ENUM 허용 목록에 추가한다(V6 의 AI 추가와 동일 패턴).
--
-- dev 환경은 이 적용 전에 ALTER TABLE 로 즉시 hotfix 됨 — Flyway 의 MODIFY COLUMN 은
-- 이미 같은 정의면 idempotent 라 충돌 없음.
ALTER TABLE `images`
  MODIFY COLUMN `source` ENUM('UNSPLASH', 'AI', 'GUIDE_REF') NOT NULL;
