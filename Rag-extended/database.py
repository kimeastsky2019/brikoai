from sqlmodel import SQLModel, create_engine
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine

import os

# 배포 시 WorkingDirectory 밖(예: /opt/sllm/data/rag.db)에 두려면 DATABASE_URL 로 덮어씁니다.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./rag.db")

# echo=True 는 모든 SQL 을 journal 에 쏟아붓습니다 — 운영에서는 끕니다.
DB_ECHO = os.getenv("DB_ECHO", "false").lower() == "true"

engine = create_async_engine(DATABASE_URL, echo=DB_ECHO, future=True)

async def init_db():
    async with engine.begin() as conn:
        # await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.run_sync(SQLModel.metadata.create_all)

async def get_session() -> AsyncSession:
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session() as session:
        yield session
