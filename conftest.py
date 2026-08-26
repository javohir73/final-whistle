"""Shared pytest fixtures.

Provides an isolated in-memory SQLite database per test so the suite never needs
a running Postgres. The same ORM models run on both engines (they are
deliberately DB-agnostic).
"""
import pytest
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
import app.models  # noqa: F401  (registers all models on Base.metadata)


@pytest.fixture(autouse=True)
def _clear_external_provider_credentials(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "api_football_api_key", "")
    monkeypatch.setattr(settings, "football_data_api_key", "")


@pytest.fixture(autouse=True)
def _block_external_requests(monkeypatch):
    def blocked(_session, method, url, **_kwargs):
        raise AssertionError(f"unmocked external HTTP: {method} {url}")

    monkeypatch.setattr(requests.sessions.Session, "request", blocked)


@pytest.fixture
def db_session() -> Session:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, future=True
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, future=True)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
