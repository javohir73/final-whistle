"""Provider failure taxonomy — the thing that stops a dead feed reading as a
quiet day.

api-sports answers **HTTP 200** with an ``errors`` object when the key is out
of quota, the plan doesn't cover an endpoint, or the token is wrong. Every
``fetch_*`` in pipeline/ingest/api_football.py used to log that at WARNING and
return ``data["response"] or []`` — an empty list indistinguishable from "this
league has no fixtures today". The daily refresh then upserted nothing,
reported every step done, and exited 0. That is the false green this module
exists to kill: a provider error becomes an exception at the fetch boundary, so
a core ingest step fails the run outright.

Two things are deliberately separate here:

* **Raising** (`read_payload`) — for callers whose data is load-bearing.
  ``load_league_structure`` is the case that matters: no fixtures means no
  matches, no predictions, and a stale site.
* **Recording** (`record` / `snapshot`) — for callers that are best-effort by
  an existing contract (odds and injuries never take the run down; see
  run_pipeline's own comments). Those still catch the exception, but the
  incident is now visible in the run summary AND makes the pipeline exit
  non-zero at the end, so "enrichment quietly stopped working three weeks ago"
  is no longer survivable.

Module-level incident state follows the precedent already set by
api_football._last_events_fetch: the pipeline is a single-process CLI run, and
a worker restart simply starts a fresh ledger.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)


class ProviderError(RuntimeError):
    """The provider did not deliver usable data. Never a "0 rows" result."""

    #: Stable machine-readable label, surfaced in run summaries and /api/health.
    kind = "error"

    def __init__(self, message: str, *, endpoint: str | None = None,
                 detail: Any = None) -> None:
        super().__init__(message)
        self.endpoint = endpoint
        self.detail = detail


class ProviderQuotaError(ProviderError):
    """Request allowance exhausted (daily cap or per-minute rate limit)."""

    kind = "quota"


class ProviderAuthError(ProviderError):
    """Key rejected, or the plan does not cover the endpoint."""

    kind = "auth"


# api-sports `errors` keys -> our taxonomy. The provider documents these as an
# object keyed by cause; anything unrecognised falls through to ProviderError
# rather than being optimistically treated as success.
_QUOTA_KEYS = frozenset({"requests", "rateLimit", "rateLimitPerMinute"})
_AUTH_KEYS = frozenset({"token", "plan", "access", "subscription"})

# Substrings for the list-shaped variant, where api-sports sends plain strings
# instead of a keyed object.
_QUOTA_TEXT = ("request limit", "rate limit", "too many requests", "quota")
_AUTH_TEXT = ("not authorized", "not allowed", "invalid api key", "your plan",
              "does not have access", "subscription")


def _normalize(errors: Any) -> dict[str, str]:
    """Coerce either api-sports error shape into ``{key: message}``.

    The provider sends a keyed object (``{"requests": "..."}``) on most
    endpoints and a bare list of strings on a few. An EMPTY list/dict is the
    success shape and normalizes to ``{}``.
    """
    if isinstance(errors, dict):
        return {str(k): str(v) for k, v in errors.items()}
    if isinstance(errors, (list, tuple)):
        return {str(i): str(v) for i, v in enumerate(errors)}
    if errors:
        return {"error": str(errors)}
    return {}


def classify(errors: Any) -> type[ProviderError] | None:
    """Return the ProviderError subclass for ``errors``, or None if clean.

    Keyed matches win over text matches: the provider's own key is a stronger
    signal than sniffing a human-readable sentence.
    """
    normalized = _normalize(errors)
    if not normalized:
        return None
    keys = set(normalized)
    if keys & _QUOTA_KEYS:
        return ProviderQuotaError
    if keys & _AUTH_KEYS:
        return ProviderAuthError
    blob = " ".join(normalized.values()).lower()
    if any(text in blob for text in _QUOTA_TEXT):
        return ProviderQuotaError
    if any(text in blob for text in _AUTH_TEXT):
        return ProviderAuthError
    return ProviderError


#: HTTP statuses that are SYSTEMIC — they do not resolve by retrying, and they
#: apply to every subsequent call with the same key. Each must become a typed
#: ProviderError *before* raise_for_status, because a best-effort caller
#: swallows a generic HTTPError without recording a blocking incident, and the
#: run exits 0. That is the same false green as the HTTP-200 errors payload,
#: reached by a different route: a revoked or expired key returns 401/403, not
#: an errors object.
#:
#: Deliberately NOT included: 5xx and other 4xx. A 500/502/504 is transient and
#: failing the nightly refresh on one flaky response is how alert fatigue
#: starts; a 404 is a bad fixture id, i.e. a bug in the caller, not a provider
#: fault. Those keep flowing through raise_for_status as before.
_SYSTEMIC_HTTP: dict[int, tuple[type[ProviderError], str]] = {
    401: (ProviderAuthError, "key rejected"),
    # api-sports/RapidAPI return 403 both for a wrong key and for an endpoint
    # the plan does not cover. Either way it is an entitlement problem.
    403: (ProviderAuthError, "forbidden — key or plan does not cover this endpoint"),
    # Payment Required: the account is out of credit. Systemic by definition.
    402: (ProviderAuthError, "payment required — provider account is not in good standing"),
    429: (ProviderQuotaError, "rate limit / quota exhausted"),
}


def read_payload(resp, *, endpoint: str) -> dict:
    """Parse an api-sports response, raising ProviderError on any failure.

    Handles the ways this provider says no:
      * A systemic HTTP status (401/402/403/429) — typed, before
        ``raise_for_status`` flattens it into an HTTPError the caller cannot
        tell apart from a transient 500.
      * Any other HTTP 4xx/5xx — via ``raise_for_status``, still an exception
        but a non-blocking one.
      * HTTP 200 with a non-empty ``errors`` payload — the false-green case.
    """
    systemic = _SYSTEMIC_HTTP.get(resp.status_code)
    if systemic is not None:
        error_cls, reason = systemic
        raise error_cls(
            f"{endpoint}: {reason} (HTTP {resp.status_code})",
            endpoint=endpoint, detail={"http_status": resp.status_code},
        )
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        raise ProviderError(
            f"{endpoint}: expected a JSON object, got {type(data).__name__}",
            endpoint=endpoint,
        )
    failure = classify(data.get("errors"))
    if failure is not None:
        detail = _normalize(data.get("errors"))
        raise failure(
            f"{endpoint}: provider returned errors {detail}",
            endpoint=endpoint, detail=detail,
        )
    return data


# --- run-level incident ledger -------------------------------------------
# Best-effort callers swallow their exception by contract; this is how the run
# still learns about it. Keyed by (kind, endpoint) so a loop over 380 fixtures
# reports one incident, not 380.
_incidents: dict[tuple[str, str], dict] = {}


def record(exc: ProviderError) -> None:
    """Log an incident a best-effort caller swallowed."""
    key = (exc.kind, exc.endpoint or "unknown")
    entry = _incidents.get(key)
    if entry is None:
        _incidents[key] = {
            "kind": exc.kind, "endpoint": exc.endpoint or "unknown",
            "message": str(exc), "count": 1,
        }
    else:
        entry["count"] += 1
    log.error("provider incident (%s) on %s: %s", exc.kind, exc.endpoint, exc)


def snapshot() -> list[dict]:
    """Every incident recorded this run, newest-insertion-order."""
    return [dict(entry) for entry in _incidents.values()]


def blocking() -> list[dict]:
    """Incidents that must fail the run even though a step swallowed them.

    Quota and auth are systemic — they do not resolve by themselves and they
    silently degrade every subsequent run. A one-off transient ProviderError
    (kind "error") is not included: the step already logged it, and failing the
    whole nightly refresh on a single flaky response is how alert fatigue
    starts.
    """
    return [entry for entry in snapshot() if entry["kind"] in ("quota", "auth")]


def reset() -> None:
    """Clear the ledger. Called at the top of a run, and by tests."""
    _incidents.clear()
