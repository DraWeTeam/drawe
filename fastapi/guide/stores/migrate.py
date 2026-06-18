"""guide/stores/migrate.py — 평문 SQL 스키마 마이그레이션 러너(자동화).

schema/ddl.sql(=논리 001) + schema/migrations/NNN_*.sql 을 *순서대로, 각 파일 한 번만* 적용한다.
수동 `mysql < ddl.sql; for f in migrations/0*.sql; mysql < $f` 루프를 대체한다.

불변식:
- 추적 테이블 `schema_version`(version PK, applied_at) 으로 멱등·순서 보장
  (마이그레이션의 ALTER 가 비멱등이라 '한 번만'이 필수).
- 동시 기동 경쟁 차단: MySQL `GET_LOCK` 어드바이저리 락 — 한 인스턴스만 적용한다.
- 이미 존재하는 객체(컬럼/인덱스/테이블 중복) 에러는 무시 → 기존 수동 부트스트랩(`mysql --force`)과
  같은 의미(부분 적용된 DB에도 안전). 그 외 에러는 실패시킨다.

용법:
  CLI(런북/ECS one-off/bastion):   python -m guide.stores.migrate
  기동 자동(dev/로컬):             환경변수 GUIDE_AUTO_MIGRATE=1 → app lifespan 이 호출(락으로 안전).
                                   prod 는 기본 비활성 → 배포 시 위 CLI 를 1회만 돌리는 통제 적용 권장.
"""

import logging
import re
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from guide.stores.db import engine

log = logging.getLogger("drawe-fastapi.guide.migrate")

_SCHEMA_DIR = Path(__file__).resolve().parents[1] / "schema"  # guide/schema
_TRACK = "schema_version"
_LOCK = "guide_schema_migrate"
# 재적용 시 정상인(이미 존재/없음) 에러코드 — mysql --force 와 동일하게 무시. 그 외는 실패.
#   1050 table exists · 1060 dup column · 1061 dup key/index · 1062 dup entry ·
#   1022 dup key · 1091 can't drop(없음) · 1826 dup FK 이름.
_IDEMPOTENT_ERRNOS = {1050, 1060, 1061, 1062, 1022, 1091, 1826}


def _errno(e):
    """SQLAlchemy 예외에서 MySQL errno 추출(없으면 None)."""
    orig = getattr(e, "orig", None) or e
    args = getattr(orig, "args", None)
    if args and isinstance(args[0], int):
        return args[0]
    return None


def _statements(sql_text):
    """`--` 라인 주석 제거 후 ';' 로 분리. (DELIMITER/프로시저 없음 → 단순 분리 안전.)"""
    stripped = "\n".join(re.sub(r"--.*$", "", ln) for ln in sql_text.splitlines())
    return [s.strip() for s in stripped.split(";") if s.strip()]


def _files():
    """[(version, path)] 순서대로. ddl.sql=논리 001('001_ddl') + migrations/NNN_*.sql 정렬."""
    items = []
    ddl = _SCHEMA_DIR / "ddl.sql"
    if ddl.is_file():
        items.append(("001_ddl", ddl))
    mig = _SCHEMA_DIR / "migrations"
    if mig.is_dir():
        for p in sorted(mig.glob("*.sql")):
            items.append((p.stem, p))
    return items


def _applied(cx):
    """추적 테이블 보장 + 적용된 version 집합."""
    cx.execute(
        text(
            f"CREATE TABLE IF NOT EXISTS {_TRACK} ("
            " version VARCHAR(128) PRIMARY KEY,"
            " applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        )
    )
    return {r[0] for r in cx.execute(text(f"SELECT version FROM {_TRACK}")).fetchall()}


def run_migrations():
    """대기 중 마이그레이션을 순서대로 적용하고, *이번에 적용한* version 리스트를 반환한다.

    락 미획득(다른 인스턴스 적용 중)이면 빈 리스트. 진짜 오류(멱등 코드 외)면 예외를 올린다(CLI 비정상 종료).
    """
    with engine.connect() as lock_cx:
        got = lock_cx.exec_driver_sql(f"SELECT GET_LOCK('{_LOCK}', 30)").scalar()
        if got != 1:
            log.warning("migrate: 락 미획득 → 다른 인스턴스가 적용 중으로 보고 건너뜀")
            return []
        try:
            with engine.begin() as cx:
                done = _applied(cx)
            applied_now = []
            for version, path in _files():
                if version in done:
                    continue
                for stmt in _statements(path.read_text(encoding="utf-8")):
                    try:
                        with (
                            engine.begin() as cx
                        ):  # DDL 은 MySQL 에서 자동커밋 → statement 단위 자율 적용
                            cx.execute(text(stmt))
                    except SQLAlchemyError as e:
                        if _errno(e) in _IDEMPOTENT_ERRNOS:
                            log.info(
                                "migrate: 이미 적용된 변경 무시(errno=%s) in %s",
                                _errno(e),
                                version,
                            )
                        else:
                            log.error("migrate: 실패 in %s: %s", version, e)
                            raise
                with engine.begin() as cx:
                    cx.execute(
                        text(f"INSERT INTO {_TRACK}(version) VALUES (:v)"),
                        {"v": version},
                    )
                applied_now.append(version)
                log.info("migrate applied: %s", version)
            return applied_now
        finally:
            lock_cx.exec_driver_sql(f"SELECT RELEASE_LOCK('{_LOCK}')")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    applied = run_migrations()
    print(f"[migrate] 적용 {len(applied)}건: {applied or '(없음 — 이미 최신)'}")
