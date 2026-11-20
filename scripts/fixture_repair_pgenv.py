"""Turn DATABASE_URL from an env file into libpq settings without exposing it.

Usage (from the backup/restore scripts only):
    PGENV="$(python3 scripts/fixture_repair_pgenv.py <env file> <workdir> [<label>])"
    # exit status checked by the caller, then: eval "$PGENV"

Prints shell ``export`` lines for PGHOST, PGPORT, PGDATABASE, PGUSER,
PGPASSFILE, PGSERVICEFILE (an empty file in <workdir>, so ~/.pg_service.conf
is never read), PGCONNECT_TIMEOUT, PGSSLMODE (only when the URL sets it) and
FW_HOST_IS_IP. The password is never printed: it goes to
<workdir>/<label>.pgpass, mode 0600, which the caller deletes on exit (it
also overrides ~/.pgpass). The callers unset every PG* variable first, so
only these settings apply.

Accepted schemes: postgresql, postgres, postgresql+psycopg2. Any other
(e.g. postgresql+asyncpg), a URL query parameter other than sslmode
(host=, port=, options= could redirect the connection), or a URL that does
not parse cleanly is refused with a fixed message that contains no part of
the URL. Exit status 1 on any refusal.
"""
from __future__ import annotations

import ipaddress
import os
import shlex
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

SCHEMES = ("postgresql", "postgres", "postgresql+psycopg2")


class Refused(Exception):
    """A fixed, value-free message for the caller."""


def read_database_url(env_file: Path) -> str:
    try:
        lines = env_file.read_text().splitlines()
    except OSError:
        raise Refused(f"cannot read env file {env_file}")
    url = None
    for line in lines:
        line = line.strip()
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if not line.startswith("DATABASE_URL="):
            continue
        value = line.split("=", 1)[1].strip()
        if value[:1] in ("'", '"'):
            end = value.find(value[0], 1)
            if end < 0:
                raise Refused("DATABASE_URL has an unterminated quote")
            value = value[1:end]
        else:
            # an unquoted value ends at the first whitespace (`... # comment`)
            value = value.split()[0] if value.split() else ""
        url = value
    if not url:
        raise Refused(f"DATABASE_URL not found in {env_file}")
    return url


def parse(url: str) -> dict:
    try:
        parts = urlsplit(url)
        scheme = parts.scheme
        host = parts.hostname or ""
        port = str(parts.port or 5432)
        user = unquote(parts.username or "")
        password = unquote(parts.password or "")
        database = unquote(parts.path[1:] if parts.path.startswith("/") else parts.path)
        query = parse_qs(parts.query, keep_blank_values=True, strict_parsing=bool(parts.query))
    except (ValueError, TypeError):
        raise Refused("DATABASE_URL does not parse; is the password URL-encoded "
                      "(/ : @ # ? % must be written as %2F %3A %40 %23 %3F %25)?")
    if scheme not in SCHEMES:
        raise Refused("DATABASE_URL scheme is not postgresql:// or postgresql+psycopg2://")
    # Host part only: a comma is legal inside the password.
    if "," in parts.netloc.rsplit("@", 1)[-1]:
        raise Refused("DATABASE_URL names more than one host; use exactly one")
    if parts.fragment or "@" in database or "/" in database or "@" in host:
        raise Refused("DATABASE_URL does not parse cleanly; is the password URL-encoded?")
    if not (host and database and user):
        raise Refused("DATABASE_URL lacks a host, database or user")
    unexpected = sorted(set(query) - {"sslmode"})
    if unexpected:
        raise Refused("DATABASE_URL has query parameters other than sslmode; remove them")
    try:
        ipaddress.ip_address(host)
        is_ip = "1"
    except ValueError:
        is_ip = "0"
    return {"host": host, "port": port, "database": database, "user": user,
            "password": password, "sslmode": (query.get("sslmode") or [None])[0],
            "is_ip": is_ip}


def _passfile_field(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:")


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print("usage: fixture_repair_pgenv.py <env file> <workdir> [<label>]", file=sys.stderr)
        return 1
    env_file, workdir = Path(argv[0]), Path(argv[1])
    label = argv[2] if len(argv) == 3 else "target"
    try:
        conn = parse(read_database_url(env_file))
    except Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    passfile = workdir / f"{label}.pgpass"
    servicefile = workdir / f"{label}.pg_service.conf"
    fd = os.open(passfile, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(":".join(_passfile_field(conn[k])
                              for k in ("host", "port", "database", "user", "password")))
        handle.write("\n")
    servicefile.write_text("")
    exports = {
        "PGHOST": conn["host"],
        "PGPORT": conn["port"],
        "PGDATABASE": conn["database"],
        "PGUSER": conn["user"],
        "PGPASSFILE": str(passfile),
        "PGSERVICEFILE": str(servicefile),
        "PGCONNECT_TIMEOUT": "15",
        "FW_HOST_IS_IP": conn["is_ip"],
    }
    if conn["sslmode"]:
        exports["PGSSLMODE"] = conn["sslmode"]
    for name, value in exports.items():
        print(f"export {name}={shlex.quote(value)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
