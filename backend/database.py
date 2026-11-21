from collections.abc import Iterator
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.orm import Session, declarative_base, sessionmaker

load_dotenv(Path(__file__).resolve().parent / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DATABASE_CONFIG_ERROR = ""
engine = None
if "<" in DATABASE_URL and ">" in DATABASE_URL:
    # Still the template from .env.example (e.g. postgres.<project-ref>:<password>@aws-<N>-...).
    DATABASE_CONFIG_ERROR = (
        "DATABASE_URL in backend/.env still has the placeholders from .env.example "
        "(<project-ref>, <password>, <N>); paste the Session pooler URL from Supabase."
    )
elif DATABASE_URL:
    try:
        parsed_url = make_url(DATABASE_URL)
    except ArgumentError:
        DATABASE_CONFIG_ERROR = "DATABASE_URL is not a valid SQLAlchemy URL."
    else:
        if parsed_url.drivername != "postgresql+psycopg":
            DATABASE_CONFIG_ERROR = "DATABASE_URL must use the Supabase PostgreSQL psycopg driver."
        else:
            engine = create_engine(
                parsed_url,
                pool_pre_ping=True,
                connect_args={"sslmode": "require"},
            )
SessionLocal = (
    sessionmaker(autocommit=False, autoflush=False, bind=engine)
    if engine is not None
    else None
)
# Retained for the legacy SQLite models; this metadata is never created on Supabase.
Base = declarative_base()


def get_db() -> Iterator[Session]:
    if SessionLocal is None:
        raise HTTPException(
            status_code=503,
            detail=DATABASE_CONFIG_ERROR
            or "Database is not configured. Set DATABASE_URL in backend/.env.",
        )

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
