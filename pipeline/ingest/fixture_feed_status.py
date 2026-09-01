"""Durable per-competition fixture-feed refresh telemetry."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import FixtureFeedStatus
from pipeline.ingest.fixture_contract import FixtureProvider, capabilities_for
from pipeline.ingest.provider_errors import ProviderError

log = logging.getLogger(__name__)

_PUBLIC_ERROR_MESSAGES = {
    "quota": "provider quota or rate limit exhausted",
    "auth": "provider authentication or entitlement failed",
    "storage": "fixture feed storage failed",
    "input": "fixture refresh input unavailable",
    "error": "fixture refresh failed",
}


def public_error_message(kind: str | None) -> str:
    """Safe public detail for a stored failure classification."""
    return _PUBLIC_ERROR_MESSAGES.get(kind or "error", "fixture refresh failed")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _upsert(
    db: Session,
    competition_code: str,
    tournament_name: str,
    provider: FixtureProvider,
) -> FixtureFeedStatus:
    row = db.query(FixtureFeedStatus).filter_by(
        competition_code=competition_code
    ).one_or_none()
    capabilities = capabilities_for(provider)
    if row is None:
        row = FixtureFeedStatus(
            competition_code=competition_code,
            tournament_name=tournament_name,
            provider=provider,
            last_attempt_at=None,
            last_success_at=None,
            last_error_at=None,
            last_error_kind=None,
            last_error=None,
            fixture_count=0,
            latest_upstream_updated_at=None,
            capabilities=capabilities,
        )
        db.add(row)
    else:
        if row.provider != provider:
            row.last_attempt_at = None
            row.last_success_at = None
            row.last_error_at = None
            row.last_error_kind = None
            row.last_error = None
            row.fixture_count = 0
            row.latest_upstream_updated_at = None
        row.tournament_name = tournament_name
        row.provider = provider
        row.capabilities = capabilities
    return row


def record_attempt(
    db: Session,
    competition_code: str,
    tournament_name: str,
    provider: FixtureProvider,
    *,
    now: datetime | None = None,
) -> FixtureFeedStatus:
    row = _upsert(db, competition_code, tournament_name, provider)
    row.last_attempt_at = now or _utc_now()
    db.commit()
    return row


def record_success(
    db: Session,
    competition_code: str,
    tournament_name: str,
    provider: FixtureProvider,
    *,
    fixture_count: int,
    latest_upstream_updated_at: datetime | None,
    now: datetime | None = None,
) -> FixtureFeedStatus:
    row = _upsert(db, competition_code, tournament_name, provider)
    row.last_success_at = now or _utc_now()
    row.last_error_at = None
    row.last_error_kind = None
    row.last_error = None
    row.fixture_count = fixture_count
    row.latest_upstream_updated_at = latest_upstream_updated_at
    row.capabilities = capabilities_for(provider)
    db.commit()
    return row


def record_failure(
    db: Session,
    competition_code: str,
    tournament_name: str,
    provider: FixtureProvider,
    error: Exception,
    *,
    now: datetime | None = None,
) -> FixtureFeedStatus:
    row = _upsert(db, competition_code, tournament_name, provider)
    row.last_error_at = now or _utc_now()
    if isinstance(error, ProviderError):
        kind = error.kind
    elif isinstance(error, SQLAlchemyError):
        kind = "storage"
    elif isinstance(error, OSError):
        kind = "input"
    else:
        kind = "error"
    log.error(
        "fixture feed failure for %s via %s (%s): %s",
        competition_code, provider, kind, error,
    )
    row.last_error_kind = kind
    row.last_error = public_error_message(kind)
    db.commit()
    return row
