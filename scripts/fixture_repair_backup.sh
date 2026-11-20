#!/usr/bin/env bash
# Back up the production database immediately before applying the fixture
# repair (docs/RUNBOOK-FIXTURE-DUPLICATE-REPAIR.md). Run from the project folder
# on the MacBook:
#
#   scripts/fixture_repair_backup.sh --verify-into <scratch url without a password>
#   scripts/fixture_repair_backup.sh --verify-into-env <file with DATABASE_URL=...>
#   scripts/fixture_repair_backup.sh --info        # pre-flight: print, dump nothing
#   [--env-file .env] [--out-dir ~/fw-backups]
#
# Writes <out-dir>/finalwhistle-<db>-<UTC stamp>.dump and a sidecar
# <dump>.meta.json (host, port, database, server identity and version,
# timezone, size, table count, matches count, alembic revision, the grants
# held by other roles, sha256, UTC time, restore_rehearsed), both mode 0600,
# and records the dump's path in <out-dir>/LATEST.
#
# Verification: the dump is converted fully to SQL and its tables and
# matches rows compared with the live database; then that SQL is LOADED into
# the scratch database given by --verify-into (its name must start with
# fw_restore_check, it must not be the production database, and its server
# must be the same major version) and counted again. Only then does it print
# "backup ok" and record "restore_rehearsed": true. Without --verify-into it
# writes the dump, records "restore_rehearsed": false and exits 3: such a
# backup is NOT verified and the runbook does not allow applying on it.
#
# Every PG* variable in your shell is ignored; ~/.pgpass and
# ~/.pg_service.conf are not read; the URL and password never appear on
# screen, in history or in `ps`. The local pg_dump, pg_restore and psql must
# be the server's major version exactly.
#
# FW_EXPECT_HOST_SUFFIX (default .render.com) is the required host suffix;
# only the rehearsal against a local database overrides it.
set -euo pipefail

ENV_FILE=.env
OUT_DIR="$HOME/fw-backups"
INFO_ONLY=0
VERIFY_URL_FILE=""
EXPECT_HOST_SUFFIX="${FW_EXPECT_HOST_SUFFIX:-.render.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
die() { echo "BACKUP FAILED: $*" >&2; exit 1; }
# shellcheck source=fixture_repair_lib.sh
source "$HERE/fixture_repair_lib.sh"
fw_traps
# An interrupted or failed run must not leave a dump that looks like a backup.
DUMP=""
COMPLETE=0
trap 'rm -rf "$WORK"; if [ "$COMPLETE" != 1 ] && [ -n "$DUMP" ]; then rm -f "$DUMP" "$DUMP.meta.json"; fi' EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --info) INFO_ONLY=1; shift ;;
    --verify-into)
      # A command line is visible in `ps` and shell history: no password here.
      case "$2" in *://*:*@*) die "--verify-into must not contain a password; put DATABASE_URL=<url> in a file and use --verify-into-env <file>" ;; esac
      ( umask 077; printf 'DATABASE_URL=%s\n' "$2" > "$WORK/scratch.env" )
      VERIFY_URL_FILE="$WORK/scratch.env"; shift 2 ;;
    --verify-into-env) VERIFY_URL_FILE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ---- the production database
fw_load_target "$ENV_FILE" prod
fw_require_host_suffix "$EXPECT_HOST_SUFFIX"
fw_connect_check
fw_server_identity
q() { psql -X -Atc "$1"; }
SERVER_NUM="$(q 'show server_version_num')"
SERVER_MAJOR=$((SERVER_NUM / 10000))
fw_require_client_major "$SERVER_MAJOR"
TIMEZONE="$(q 'show timezone')"
SIZE_BYTES="$(q 'select pg_database_size(current_database())')"
SIZE_PRETTY="$(q 'select pg_size_pretty(pg_database_size(current_database()))')"
TABLES="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")"
MATCHES="$(q 'select count(*) from matches')"
ALEMBIC="$(q 'select version_num from alembic_version')"
[ "$MATCHES" -gt 0 ] || die "matches is empty: this is not the production database"

# Privileges other roles hold (lost by a plain --no-acl restore; the restore
# script re-applies them from the sidecar). \x1f separates fields.
SEP=$'\x1f'
psql -X -At -F "$SEP" -c "
  select 'schema', 'public', '', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type
    from pg_namespace n, aclexplode(n.nspacl) a
   where n.nspname = 'public' and a.grantee <> n.nspowner
  union all
  select case when c.relkind = 'S' then 'sequence' else 'table' end, c.relname, '',
         case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') and a.grantee <> c.relowner
  union all
  select 'default', d.defaclobjtype::text, pg_get_userbyid(d.defaclrole),
         case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type
    from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclnamespace = 'public'::regnamespace
  order by 1, 2, 4, 5" > "$WORK/grants.tsv"
SCHEMA_OWNER="$(q "select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'public'")"
OTHER_ROLES="$(cut -d "$SEP" -f 4 "$WORK/grants.tsv" | sort -u | tr '\n' ' ')"

if [ "$INFO_ONLY" = 1 ]; then
  echo "database $PGDATABASE on $PGHOST (server says ${SERVER_ADDR:-?}:${SERVER_PORT:-?}), user $PGUSER"
  echo "  server $SERVER_NUM; local pg_dump/pg_restore/psql $SERVER_MAJOR (match)"
  echo "  size $SIZE_PRETTY: a restore needs about twice that free on the database's disk"
  echo "  timezone $TIMEZONE, $TABLES tables, $MATCHES matches, alembic $ALEMBIC"
  echo "  public schema owner: $SCHEMA_OWNER"
  echo "  other roles holding privileges: ${OTHER_ROLES:-none}"
  case "$TIMEZONE" in UTC|Etc/UTC) echo "timezone ok" ;; *) die "timezone is $TIMEZONE, not UTC: stop and ask" ;; esac
  exit 0
fi

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$OUT_DIR/finalwhistle-$PGDATABASE-$STAMP.dump"
umask 077
pg_dump --format=custom --no-owner --no-acl --file="$DUMP" || die "pg_dump failed"

# Verify the dump as a restore reads it: fully converted to SQL.
pg_restore --no-owner --no-acl --file="$WORK/plain.sql" "$DUMP" || die "pg_restore cannot read the new dump"
COPIES="$( (grep -c '^COPY public\.' "$WORK/plain.sql" || true) )"
DUMP_MATCHES="$( (sed -n '/^COPY public\.matches /,/^\\\.$/p' "$WORK/plain.sql" \
  | grep -vc -e '^COPY ' -e '^\\\.$' || true) )"
[ "$COPIES" -eq "$TABLES" ] || die "dump has data for $COPIES tables, database has $TABLES"
[ "$DUMP_MATCHES" -eq "$MATCHES" ] || die "dump has $DUMP_MATCHES matches rows, database has $MATCHES"
SHA256="$(shasum -a 256 "$DUMP" | cut -d' ' -f1)"
PROD_HOST="$PGHOST"; PROD_PORT="$PGPORT"; PROD_DB="$PGDATABASE"; PROD_USER="$PGUSER"
PROD_ADDR="$SERVER_ADDR"; PROD_SERVER_PORT="$SERVER_PORT"

# ---- rehearse the restore into a scratch database
REHEARSED=false
SCRATCH_DESC=""
if [ -n "$VERIFY_URL_FILE" ]; then
  fw_load_target "$VERIFY_URL_FILE" scratch
  case "$PGDATABASE" in fw_restore_check*) ;; *) die "the scratch database's name must start with fw_restore_check" ;; esac
  if [ "$PGHOST" = "$PROD_HOST" ] && [ "$PGPORT" = "$PROD_PORT" ] && [ "$PGDATABASE" = "$PROD_DB" ]; then
    die "the scratch database is the production database"
  fi
  fw_connect_check
  fw_server_identity
  [ "$(( $(psql -X -Atc 'show server_version_num') / 10000 ))" = "$SERVER_MAJOR" ] \
    || die "the scratch server is not PostgreSQL $SERVER_MAJOR"
  { echo "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"; cat "$WORK/plain.sql"; } \
    | PGOPTIONS='-c client_min_messages=warning' \
      psql -X --single-transaction --set ON_ERROR_STOP=1 --quiet > /dev/null 2> "$WORK/scratch.err" \
    || { echo "--- last lines from psql (scratch load) ---" >&2; tail -n 15 "$WORK/scratch.err" | fw_scrub >&2
         die "the dump does not load into the scratch database"; }
  S_TABLES="$(psql -X -Atc "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")"
  S_MATCHES="$(psql -X -Atc 'select count(*) from matches')"
  [ "$S_TABLES" = "$TABLES" ] || die "scratch load has $S_TABLES tables, production $TABLES"
  [ "$S_MATCHES" = "$MATCHES" ] || die "scratch load has $S_MATCHES matches rows, production $MATCHES"
  REHEARSED=true
  SCRATCH_DESC="$PGDATABASE on $PGHOST:$PGPORT"
fi

python3 - "$DUMP.meta.json" "$WORK/grants.tsv" \
  "dump_file=$(basename "$DUMP")" "host=$PROD_HOST" "port=$PROD_PORT" "database=$PROD_DB" \
  "user=$PROD_USER" "server_addr=$PROD_ADDR" "server_port=$PROD_SERVER_PORT" \
  "server_version_num=$SERVER_NUM" "server_major=$SERVER_MAJOR" "timezone=$TIMEZONE" \
  "size_bytes=$SIZE_BYTES" "table_count=$TABLES" "copy_count=$COPIES" "matches=$MATCHES" \
  "alembic_version=$ALEMBIC" "schema_owner=$SCHEMA_OWNER" "sha256=$SHA256" \
  "created_utc=$STAMP" "restore_rehearsed=$REHEARSED" "rehearsed_into=$SCRATCH_DESC" <<'PY'
import json, sys
out, grants_file, *pairs = sys.argv[1:]
meta = dict(pair.split("=", 1) for pair in pairs)
for key in ("server_version_num", "server_major", "size_bytes", "table_count", "copy_count",
            "matches"):
    meta[key] = int(meta[key])
meta["restore_rehearsed"] = meta["restore_rehearsed"] == "true"
fields = ("kind", "object", "role", "grantee", "privilege")
meta["grants"] = [dict(zip(fields, line.rstrip("\n").split("\x1f")))
                  for line in open(grants_file) if line.strip()]
json.dump(meta, open(out, "w"), indent=2)
PY
chmod 600 "$DUMP" "$DUMP.meta.json"
COMPLETE=1
echo "$DUMP" > "$OUT_DIR/LATEST"

echo "  file:      $DUMP"
echo "  database:  $PROD_DB on $PROD_HOST (server $SERVER_NUM; local client $SERVER_MAJOR)"
echo "  tables:    $TABLES (all present in the dump)"
echo "  matches:   $MATCHES (same in the dump)"
echo "  size:      $SIZE_PRETTY"
echo "  alembic:   $ALEMBIC"
echo "  other roles holding privileges: ${OTHER_ROLES:-none} (re-applied by the restore)"
echo "  sha256:    $SHA256"
case "$TIMEZONE" in
  UTC|Etc/UTC) echo "  timezone:  $TIMEZONE" ;;
  *) echo "  timezone:  $TIMEZONE  <-- NOT UTC: stop and ask before applying the repair" ;;
esac
if [ "$REHEARSED" = true ]; then
  echo "  restore rehearsed into $SCRATCH_DESC: $S_TABLES tables, $S_MATCHES matches"
  echo "backup ok"
else
  echo "BACKUP WRITTEN BUT NOT VERIFIED: no --verify-into scratch database was given, so the" >&2
  echo "restore was not rehearsed (sidecar: restore_rehearsed=false). Do not apply on it." >&2
  exit 3
fi
