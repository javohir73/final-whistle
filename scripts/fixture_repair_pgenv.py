"""Turn DATABASE_URL from an env file into libpq settings without exposing it.

Usage (from the backup/restore scripts only):
    eval "$(python3 scripts/fixture_repair_pgenv.py <env file> <passfile path>)"

Prints shell ``export`` lines for PGHOST, PGPORT, PGDATABASE, PGUSER,
PGSSLMODE (when the URL sets it) and PGPASSFILE. The password is never
printed: it is written to <passfile path>, created with mode 0600, which the
calling script removes on exit. Nothing here puts the URL or the password in
shell history, in ``ps`` output or on the terminal. The SQLAlchemy driver
suffix (``postgresql+psycopg2://``) is accepted.
"""
from __future__ import annotations

import os
import shlex
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


def read_database_url(env_file: Path) -> str:
    url = None
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip().strip("'\"")
    if not url:
        raise SystemExit(f"DATABASE_URL not found in {env_file}")
    return url


def _passfile_field(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        raise SystemExit("usage: fixture_repair_pgenv.py <env file> <passfile path>")
    env_file, passfile = Path(argv[0]), Path(argv[1])
    parts = urlsplit(read_database_url(env_file))
    if parts.scheme not in ("postgresql", "postgres", "postgresql+psycopg2"):
        raise SystemExit("DATABASE_URL is not a PostgreSQL url")
    host = parts.hostname or ""
    port = str(parts.port or 5432)
    database = unquote(parts.path.lstrip("/"))
    user = unquote(parts.username or "")
    password = unquote(parts.password or "")
    if not (host and database and user):
        raise SystemExit("DATABASE_URL lacks a host, database or user")
    fd = os.open(passfile, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(":".join(_passfile_field(v) for v in (host, port, database, user, password)))
        handle.write("\n")
    exports = {
        "PGHOST": host,
        "PGPORT": port,
        "PGDATABASE": database,
        "PGUSER": user,
        "PGPASSFILE": str(passfile),
    }
    sslmode = parse_qs(parts.query).get("sslmode")
    if sslmode:
        exports["PGSSLMODE"] = sslmode[0]
    for name, value in exports.items():
        print(f"export {name}={shlex.quote(value)}")
    print("unset PGPASSWORD PGSERVICE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
