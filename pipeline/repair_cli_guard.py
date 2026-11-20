"""Sanitised start-up failures for the repair and undo command lines.

The tools import ``app.db``, which creates the database engine at import
time; a malformed DATABASE_URL (a non-numeric port, an unknown driver) fails
there, before ``main()`` and its sanitising error handling run, and the
default hook would print a traceback containing parts of the URL. Installed
first thing when run as a script (stdlib only, so it cannot fail itself).
"""
from __future__ import annotations

import os
import sys


def _hook(exc_type, exc, tb) -> None:
    if issubclass(exc_type, KeyboardInterrupt):
        print("INTERRUPTED: nothing was written", file=sys.stderr)
        code = 130
    else:
        print(f"ERROR: could not start ({exc_type.__name__}). Check DATABASE_URL: it must be "
              "postgresql+psycopg2://user:password@host:port/database with a numeric port "
              "and a URL-encoded password.", file=sys.stderr)
        code = 4
    sys.stderr.flush()
    os._exit(code)


def install() -> None:
    sys.excepthook = _hook
