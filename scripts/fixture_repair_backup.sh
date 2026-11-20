#!/usr/bin/env bash
# Back up the production database immediately before applying the fixture
# repair (docs/RUNBOOK-FIXTURE-DUPLICATE-REPAIR.md). Run from the project folder
# on the MacBook:
#
#   scripts/fixture_repair_backup.sh [--env-file .env] [--out-dir ~/fw-backups]
#   scripts/fixture_repair_backup.sh --info     # pre-flight: print, dump nothing
#
# Writes <out-dir>/finalwhistle-<db>-<UTC stamp>.dump and a sidecar
# <dump>.meta.json (host, port, database, server and pg_dump versions,
# timezone, table count, matches count, alembic revision, sha256, UTC time),
# both mode 0600, and records the dump's path in <out-dir>/LATEST. It
# verifies the dump by converting it fully to SQL and counting its tables and
# its matches rows against the live database. Exits non-zero on any problem.
# The URL and password never appear on screen, in history or in `ps`.
#
# FW_EXPECT_HOST_SUFFIX (default .render.com) is the required host suffix;
# only the rehearsal against a local database overrides it.
set -euo pipefail

ENV_FILE=.env
OUT_DIR="$HOME/fw-backups"
INFO_ONLY=0
EXPECT_HOST_SUFFIX="${FW_EXPECT_HOST_SUFFIX:-.render.com}"
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --info) INFO_ONLY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "BACKUP FAILED: $*" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

[ -f "$ENV_FILE" ] || die "env file $ENV_FILE not found"
eval "$(python3 "$HERE/fixture_repair_pgenv.py" "$ENV_FILE" "$WORK/pgpass")"
case "$PGHOST" in
  *"$EXPECT_HOST_SUFFIX") ;;
  *) die "database host is not Render's external host (*$EXPECT_HOST_SUFFIX); use the EXTERNAL url" ;;
esac
psql -X -Atc "select 1" > /dev/null 2>&1 || die "cannot connect to database $PGDATABASE on $PGHOST"

q() { psql -X -Atc "$1"; }
SERVER_NUM="$(q 'show server_version_num')"
SERVER_MAJOR=$((SERVER_NUM / 10000))
DUMP_MAJOR="$(pg_dump --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/')"
RESTORE_MAJOR="$(pg_restore --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/')"
[ "$DUMP_MAJOR" -ge "$SERVER_MAJOR" ] \
  || die "local pg_dump $DUMP_MAJOR is older than the server ($SERVER_MAJOR); brew install postgresql@$SERVER_MAJOR and put its bin first in PATH"
[ "$RESTORE_MAJOR" -ge "$DUMP_MAJOR" ] || die "local pg_restore $RESTORE_MAJOR is older than pg_dump $DUMP_MAJOR"
TIMEZONE="$(q 'show timezone')"
TABLES="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")"
MATCHES="$(q 'select count(*) from matches')"
ALEMBIC="$(q 'select version_num from alembic_version')"
[ "$MATCHES" -gt 0 ] || die "matches is empty: this is not the production database"
if [ "$INFO_ONLY" = 1 ]; then
  echo "database $PGDATABASE on $PGHOST: server $SERVER_NUM, local pg_dump $DUMP_MAJOR,"
  echo "  timezone $TIMEZONE, $TABLES tables, $MATCHES matches, alembic $ALEMBIC"
  case "$TIMEZONE" in UTC|Etc/UTC) echo "timezone ok" ;; *) die "timezone is $TIMEZONE, not UTC: stop and ask" ;; esac
  exit 0
fi

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$OUT_DIR/finalwhistle-$PGDATABASE-$STAMP.dump"
umask 077
pg_dump --format=custom --no-owner --no-acl --file="$DUMP" || die "pg_dump failed"

# Verify the dump as a restore would read it: fully converted to SQL.
pg_restore --no-owner --no-acl --file="$WORK/plain.sql" "$DUMP" || die "pg_restore cannot read the new dump"
COPIES="$( (grep -c '^COPY public\.' "$WORK/plain.sql" || true) )"
DUMP_MATCHES="$( (sed -n '/^COPY public\.matches /,/^\\\.$/p' "$WORK/plain.sql" \
  | grep -vc -e '^COPY ' -e '^\\\.$' || true) )"
[ "$COPIES" -eq "$TABLES" ] || die "dump has data for $COPIES tables, database has $TABLES"
[ "$DUMP_MATCHES" -eq "$MATCHES" ] || die "dump has $DUMP_MATCHES matches rows, database has $MATCHES"
SHA256="$(shasum -a 256 "$DUMP" | cut -d' ' -f1)"

python3 - "$DUMP.meta.json" <<PY
import json, sys
json.dump({
    "dump_file": "$(basename "$DUMP")",
    "host": "$PGHOST", "port": "$PGPORT", "database": "$PGDATABASE",
    "server_version_num": int("$SERVER_NUM"), "pg_dump_major": int("$DUMP_MAJOR"),
    "timezone": "$TIMEZONE", "table_count": int("$TABLES"), "copy_count": int("$COPIES"),
    "matches": int("$MATCHES"), "alembic_version": "$ALEMBIC",
    "sha256": "$SHA256", "created_utc": "$STAMP",
}, open(sys.argv[1], "w"), indent=2)
PY
chmod 600 "$DUMP" "$DUMP.meta.json"
echo "$DUMP" > "$OUT_DIR/LATEST"

echo "backup ok"
echo "  file:      $DUMP"
echo "  database:  $PGDATABASE on $PGHOST (server $SERVER_NUM, pg_dump $DUMP_MAJOR)"
echo "  tables:    $TABLES (all present in the dump)"
echo "  matches:   $MATCHES (same in the dump)"
echo "  alembic:   $ALEMBIC"
echo "  sha256:    $SHA256"
if [ "$TIMEZONE" = "UTC" ] || [ "$TIMEZONE" = "Etc/UTC" ]; then
  echo "  timezone:  $TIMEZONE"
else
  echo "  timezone:  $TIMEZONE  <-- NOT UTC: stop and ask before applying the repair"
fi
