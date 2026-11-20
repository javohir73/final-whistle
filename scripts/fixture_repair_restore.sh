#!/usr/bin/env bash
# Replace the production database with a backup taken by
# scripts/fixture_repair_backup.sh (docs/RUNBOOK-FIXTURE-DUPLICATE-REPAIR.md,
# "Restore from the backup"). Run from the project folder on the MacBook:
#
#   scripts/fixture_repair_restore.sh <dump file> [--env-file .env]
#
# Nothing is changed unless every check passes, in this order:
#   1. the dump matches the sha256 in its sidecar (<dump>.meta.json);
#   2. the local pg_restore can convert the WHOLE dump to SQL, and that SQL
#      has data for exactly the recorded number of tables and matches rows;
#   3. the target from the env file is the recorded host, port and database
#      (checked locally and with current_database() on the server);
#   4. you type the database name.
# Then the schema is replaced and the dump loaded in ONE transaction
# (ON_ERROR_STOP): any failure leaves the database as it was. Afterwards the
# table count, matches count and alembic revision are compared with the
# sidecar; "restore committed and verified" is printed only if they match.
# The URL and password never appear on screen, in history or in `ps`.
set -euo pipefail

DUMP=""
ENV_FILE=.env
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    -*) echo "unknown argument: $1" >&2; exit 2 ;;
    *) DUMP="$1"; shift ;;
  esac
done

die() { echo "RESTORE REFUSED: $* (nothing was changed)" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

[ -n "$DUMP" ] || die "usage: $0 <dump file> [--env-file .env]"
[ -f "$DUMP" ] || die "dump $DUMP not found"
META="$DUMP.meta.json"
[ -f "$META" ] || die "sidecar $META not found (only backups made by fixture_repair_backup.sh can be restored)"

eval "$(python3 - "$META" <<'PY'
import json, shlex, sys
meta = json.load(open(sys.argv[1]))
for key in ("host", "port", "database", "pg_dump_major", "table_count", "copy_count",
            "matches", "alembic_version", "sha256", "created_utc"):
    print(f"META_{key.upper()}={shlex.quote(str(meta[key]))}")
PY
)"

# 1. The file is the one that was backed up.
SHA256="$(shasum -a 256 "$DUMP" | cut -d' ' -f1)"
[ "$SHA256" = "$META_SHA256" ] || die "dump does not match its sidecar's sha256 (corrupt, truncated or replaced)"

# 2. The whole dump converts to SQL with every table and every matches row.
RESTORE_MAJOR="$(pg_restore --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/')"
[ "$RESTORE_MAJOR" -ge "$META_PG_DUMP_MAJOR" ] \
  || die "local pg_restore $RESTORE_MAJOR is older than the pg_dump $META_PG_DUMP_MAJOR that made the dump"
pg_restore --no-owner --no-acl --file="$WORK/plain.sql" "$DUMP" 2> "$WORK/pg_restore.err" \
  || die "pg_restore cannot read the dump"
COPIES="$( (grep -c '^COPY public\.' "$WORK/plain.sql" || true) )"
DUMP_MATCHES="$( (sed -n '/^COPY public\.matches /,/^\\\.$/p' "$WORK/plain.sql" \
  | grep -vc -e '^COPY ' -e '^\\\.$' || true) )"
[ "$COPIES" -eq "$META_COPY_COUNT" ] || die "dump converts to $COPIES tables with data, sidecar says $META_COPY_COUNT"
[ "$DUMP_MATCHES" -eq "$META_MATCHES" ] || die "dump holds $DUMP_MATCHES matches rows, sidecar says $META_MATCHES"

# 3. The target is the database the backup came from.
[ -f "$ENV_FILE" ] || die "env file $ENV_FILE not found"
eval "$(python3 "$HERE/fixture_repair_pgenv.py" "$ENV_FILE" "$WORK/pgpass")"
[ "$PGHOST" = "$META_HOST" ] || die "target host is not the recorded host"
[ "$PGPORT" = "$META_PORT" ] || die "target port is not the recorded port"
[ "$PGDATABASE" = "$META_DATABASE" ] || die "target database $PGDATABASE is not the recorded $META_DATABASE"
SERVER_DB="$(psql -X -Atc 'select current_database()' 2>/dev/null)" || die "cannot connect to the target"
[ "$SERVER_DB" = "$META_DATABASE" ] || die "server reports database $SERVER_DB, not $META_DATABASE"

# 4. A person confirms.
echo "This REPLACES the whole database '$META_DATABASE' on $META_HOST with the backup"
echo "taken at $META_CREATED_UTC. Everything written since then is lost."
printf "Type the database name to continue: "
read -r ANSWER || ANSWER=""
[ "$ANSWER" = "$META_DATABASE" ] || die "confirmation did not match"

# One transaction: on any error nothing changes.
{ echo "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"; cat "$WORK/plain.sql"; } \
  | PGOPTIONS='-c client_min_messages=warning' \
    psql -X --single-transaction --set ON_ERROR_STOP=1 --quiet > /dev/null 2> "$WORK/psql.err" \
  || die "the restore transaction failed and was rolled back"

q() { psql -X -Atc "$1"; }
TABLES_NOW="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")"
MATCHES_NOW="$(q 'select count(*) from matches')"
ALEMBIC_NOW="$(q 'select version_num from alembic_version')"
if [ "$TABLES_NOW" != "$META_TABLE_COUNT" ] || [ "$MATCHES_NOW" != "$META_MATCHES" ] \
   || [ "$ALEMBIC_NOW" != "$META_ALEMBIC_VERSION" ]; then
  echo "RESTORE COMMITTED BUT VERIFICATION FAILED: tables $TABLES_NOW/$META_TABLE_COUNT," \
       "matches $MATCHES_NOW/$META_MATCHES, alembic $ALEMBIC_NOW/$META_ALEMBIC_VERSION" >&2
  exit 1
fi
echo "restore committed and verified: $TABLES_NOW tables, $MATCHES_NOW matches, alembic $ALEMBIC_NOW"
