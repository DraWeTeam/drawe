from sqlalchemy import create_engine
from guide.config import settings

engine = create_engine(
    settings.db_dsn,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 2},
    pool_timeout=2,
)
