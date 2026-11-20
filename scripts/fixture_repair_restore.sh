#!/usr/bin/env bash
# Replace the production database with a backup taken by
# scripts/fixture_repair_backup.sh (docs/RUNBOOK-FIXTURE-DUPLICATE-REPAIR.md,
# "Restore from the backup"). The API MUST be suspended first. Run from the
# project folder on the MacBook:
#
#   scripts/fixture_repair_restore.sh <dump file> [--env-file .env]
#
# Nothing is changed unless every check passes, in this order:
#   1. the dump matches the sha256 in its sidecar (<dump>.meta.json), and the
#      sidecar says the restore was rehearsed (restore_rehearsed: true);
#   2. the local pg_restore and psql are the dump's server major version,
#      pg_restore converts the WHOLE dump to SQL, and that SQL has data for
#      exactly the recorded number of tables and matches rows;
#   3. the target from the env file is the recorded host, port, database and
#      user, confirmed on the server (current_database(), current_user);
#   4. you type the database name.
# Then, in ONE transaction (ON_ERROR_STOP, lock_timeout 5s so it stops instead
# of queueing behind a live connection): the public schema is replaced, the
# dump loaded, the schema's owner and the grants other roles held (recorded
# at backup time) re-applied. Any failure leaves the database as it was and
# prints the last lines of psql's error (connection strings removed).
# Afterwards table count, matches count and alembic revision are compared
# with the sidecar; "restore committed and verified" is printed only then.
# Every PG* variable in your shell is ignored; the URL and password never
# appear on screen, in history or in `ps`.
set -euo pipefail

DUMP=""
ENV_FILE=.env
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
die() { echo "RESTORE REFUSED: $* (nothing was changed)" >&2; exit 1; }
# shellcheck source=fixture_repair_lib.sh
source "$HERE/fixture_repair_lib.sh"
fw_traps

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    -*) echo "unknown argument: $1" >&2; exit 2 ;;
    *) DUMP="$1"; shift ;;
  esac
done

[ -n "$DUMP" ] || die "usage: $0 <dump file> [--env-file .env]"
[ -f "$DUMP" ] || die "dump $DUMP not found"
META="$DUMP.meta.json"
[ -f "$META" ] || die "sidecar $META not found (only backups made by fixture_repair_backup.sh can be restored)"

META_SH="$(python3 - "$META" "$WORK/grants.sql" <<'PY'
import json, re, shlex, sys
meta = json.load(open(sys.argv[1]))
for key in ("host", "port", "database", "user", "server_major", "table_count", "copy_count",
            "matches", "alembic_version", "sha256", "created_utc", "restore_rehearsed",
            "schema_owner"):
    print(f"META_{key.upper()}={shlex.quote(str(meta[key]))}")
# The grants other roles held, as SQL (identifiers quoted, privileges and
# object kinds from fixed lists). Re-applied inside the restore transaction.
PRIVS = {"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER",
         "USAGE", "CREATE"}
def ident(name):
    return "PUBLIC" if name == "PUBLIC" else '"' + name.replace('"', '""') + '"'
kinds = {"r": "TABLES", "S": "SEQUENCES", "f": "FUNCTIONS", "T": "TYPES", "n": "SCHEMAS"}
lines = []
for g in meta.get("grants", []):
    if g["privilege"] not in PRIVS:
        raise SystemExit(f"unexpected privilege in sidecar: {g['privilege']!r}")
    if g["kind"] == "schema":
        lines.append(f"GRANT {g['privilege']} ON SCHEMA public TO {ident(g['grantee'])};")
    elif g["kind"] in ("table", "sequence"):
        lines.append(f"GRANT {g['privilege']} ON {g['kind'].upper()} public.{ident(g['object'])} "
                     f"TO {ident(g['grantee'])};")
    elif g["kind"] == "default" and g["object"] in kinds:
        lines.append(f"ALTER DEFAULT PRIVILEGES FOR ROLE {ident(g['role'])} IN SCHEMA public "
                     f"GRANT {g['privilege']} ON {kinds[g['object']]} TO {ident(g['grantee'])};")
open(sys.argv[2], "w").write("\n".join(lines) + "\n")
print(f"META_GRANT_COUNT={len(lines)}")
print("META_GRANTEES=" + shlex.quote(" ".join(sorted({g["grantee"] for g in meta.get("grants", [])}))))
PY
)" || die "the sidecar $META is unreadable"
eval "$META_SH"

# 1. The file is the one that was backed up, and its restore was rehearsed.
SHA256="$(shasum -a 256 "$DUMP" | cut -d' ' -f1)"
[ "$SHA256" = "$META_SHA256" ] || die "dump does not match its sidecar's sha256 (corrupt, truncated or replaced)"
[ "$META_RESTORE_REHEARSED" = "True" ] || die "this backup's restore was never rehearsed (restore_rehearsed is false). Use the verified pre-apply dump (the DUMP= line the backup printed, or ~/fw-backups/PRE-APPLY). Never take a new backup of the current state over it"

# 2. Matching client tools; the whole dump converts with every table and row.
fw_require_client_major "$META_SERVER_MAJOR"
pg_restore --no-owner --no-acl --file="$WORK/plain.sql" "$DUMP" 2> "$WORK/pg_restore.err" \
  || { tail -n 5 "$WORK/pg_restore.err" | fw_scrub >&2; die "pg_restore cannot read the dump"; }
COPIES="$( (grep -c '^COPY public\.' "$WORK/plain.sql" || true) )"
DUMP_MATCHES="$( (sed -n '/^COPY public\.matches /,/^\\\.$/p' "$WORK/plain.sql" \
  | grep -vc -e '^COPY ' -e '^\\\.$' || true) )"
[ "$COPIES" -eq "$META_COPY_COUNT" ] || die "dump converts to $COPIES tables with data, sidecar says $META_COPY_COUNT"
[ "$DUMP_MATCHES" -eq "$META_MATCHES" ] || die "dump holds $DUMP_MATCHES matches rows, sidecar says $META_MATCHES"

# 3. The target is the database the backup came from.
fw_load_target "$ENV_FILE" target
[ "$PGHOST" = "$META_HOST" ] || die "target host is not the recorded host"
[ "$PGPORT" = "$META_PORT" ] || die "target port is not the recorded port"
[ "$PGDATABASE" = "$META_DATABASE" ] || die "target database $PGDATABASE is not the recorded $META_DATABASE"
[ "$PGUSER" = "$META_USER" ] || die "target user is not the recorded user"
fw_connect_check
fw_server_identity
SERVER_MAJOR="$(( $(psql -X -Atc 'show server_version_num') / 10000 ))"
[ "$SERVER_MAJOR" = "$META_SERVER_MAJOR" ] || die "the server is PostgreSQL $SERVER_MAJOR, the dump came from $META_SERVER_MAJOR"
MISSING=""
for role in $META_GRANTEES; do
  [ "$role" = PUBLIC ] && continue
  [ "$(psql -X -Atc "select count(*) from pg_roles where rolname = '$(printf '%s' "$role" | sed "s/'/''/g")'")" = 1 ] \
    || MISSING="$MISSING $role"
done
[ -z "$MISSING" ] || die "roles that held grants no longer exist:$MISSING"

# 4. A person confirms.
echo "This REPLACES the whole database '$META_DATABASE' on $META_HOST with the backup"
echo "taken at $META_CREATED_UTC. Everything written since then is lost. The API must be suspended."
printf "Type the database name to continue: "
read -r ANSWER || ANSWER=""
[ "$ANSWER" = "$META_DATABASE" ] || die "confirmation did not match"

# One transaction: on any error nothing changes.
{
  echo "DROP SCHEMA public CASCADE;"
  echo "CREATE SCHEMA public;"
  cat "$WORK/plain.sql"
  echo "SET search_path = public, pg_catalog;"
  printf 'ALTER SCHEMA public OWNER TO %s;\n' "\"$(printf '%s' "$META_SCHEMA_OWNER" | sed 's/"/""/g')\""
  cat "$WORK/grants.sql"
} | PGOPTIONS='-c client_min_messages=warning -c lock_timeout=5s' \
    psql -X --single-transaction --set ON_ERROR_STOP=1 --quiet > /dev/null 2> "$WORK/psql.err" \
  || { echo "--- last lines from psql ---" >&2; tail -n 15 "$WORK/psql.err" | fw_scrub >&2
       grep -q "lock timeout" "$WORK/psql.err" \
         && echo "(a lock timeout: another connection is using the database; suspend the API and retry)" >&2
       die "the restore transaction failed and was rolled back"; }

# The restore is committed from here on: a failing check query must report
# that, not end the script on set -e with a bare psql error.
q() { psql -X -Atc "$1" 2>/dev/null || echo "(query failed)"; }
TABLES_NOW="$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")"
MATCHES_NOW="$(q 'select count(*) from matches')"
ALEMBIC_NOW="$(q 'select version_num from alembic_version')"
OWNER_NOW="$(q "select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'public'")"
if [ "$TABLES_NOW" != "$META_TABLE_COUNT" ] || [ "$MATCHES_NOW" != "$META_MATCHES" ] \
   || [ "$ALEMBIC_NOW" != "$META_ALEMBIC_VERSION" ] || [ "$OWNER_NOW" != "$META_SCHEMA_OWNER" ]; then
  echo "RESTORE COMMITTED BUT VERIFICATION FAILED: tables $TABLES_NOW/$META_TABLE_COUNT," \
       "matches $MATCHES_NOW/$META_MATCHES, alembic $ALEMBIC_NOW/$META_ALEMBIC_VERSION," \
       "schema owner $OWNER_NOW/$META_SCHEMA_OWNER" >&2
  exit 1
fi
echo "restore committed and verified: $TABLES_NOW tables, $MATCHES_NOW matches, alembic $ALEMBIC_NOW, $META_GRANT_COUNT grants re-applied"
