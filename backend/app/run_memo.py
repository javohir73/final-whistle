"""Per-run read memo for batch jobs that hit the database once per row.

The daily prediction pass runs on a CI runner against a remote Postgres, so
every SELECT is a network round trip. Inside one pass the same rows are read
again and again — each team's squad, latest stats and finished matches, each
match's odds and lineups — once per shadow twin. ``run_memo(db)`` installs a
dict on ``Session.info`` for the duration of the pass; helpers that read
through ``memo()`` then load each key once. With no memo installed (every
API request path) ``memo()`` just calls the loader, so behaviour outside a
batch pass is untouched.

Only install it around code that does NOT write the rows being memoised:
the cache is never invalidated.
"""
from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import TypeVar

from sqlalchemy.orm import Session

T = TypeVar("T")

_KEY = "run_memo"


@contextmanager
def run_memo(db: Session) -> Iterator[dict]:
    """Install a fresh memo on ``db`` for the block (re-entrant: a nested
    call reuses the outer memo and leaves its removal to the outer block)."""
    if _KEY in db.info:
        yield db.info[_KEY]
        return
    cache: dict = {}
    db.info[_KEY] = cache
    try:
        yield cache
    finally:
        db.info.pop(_KEY, None)


def active(db: Session) -> dict | None:
    """The installed memo, or None outside a batch pass."""
    return db.info.get(_KEY)


def memo(db: Session, key: tuple, load: Callable[[], T]) -> T:
    """``load()`` once per ``key`` while a memo is installed, else every call."""
    cache = db.info.get(_KEY)
    if cache is None:
        return load()
    if key not in cache:
        cache[key] = load()
    return cache[key]
