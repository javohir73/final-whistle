# Shared by fixture_repair_backup.sh and fixture_repair_restore.sh (bash 3.2+).
# Source it after `set -euo pipefail` and after defining die() and WORK.

# Every libpq environment variable (PostgreSQL 16 docs, "Environment
# Variables", plus PG17's PGSSLNEGOTIATION) and anything else starting PG,
# so an exported PGHOST/PGHOSTADDR/PGPORT/PGOPTIONS/PGSERVICE/... from the
# owner's shell can never redirect or alter the connection.
fw_clean_pg_env() {
  local v
  for v in PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE \
           PGCHANNELBINDING PGSERVICE PGSERVICEFILE PGOPTIONS PGAPPNAME PGSSLMODE \
           PGREQUIRESSL PGSSLCOMPRESSION PGSSLCERT PGSSLKEY PGSSLCERTMODE PGSSLROOTCERT \
           PGSSLCRL PGSSLCRLDIR PGSSLSNI PGREQUIREPEER PGSSLMINPROTOCOLVERSION \
           PGSSLMAXPROTOCOLVERSION PGSSLNEGOTIATION PGGSSENCMODE PGKRBSRVNAME PGGSSLIB \
           PGGSSDELEGATION PGCONNECT_TIMEOUT PGCLIENTENCODING PGTARGETSESSIONATTRS \
           PGLOADBALANCEHOSTS PGREQUIREAUTH PGDATESTYLE PGTZ PGGEQO PGSYSCONFDIR PGLOCALEDIR; do
    unset "$v"
  done
  for v in $(compgen -e | grep '^PG' || true); do unset "$v"; done
}

# fw_load_target <env file> <label>: export only what the env file says.
fw_load_target() {
  local out
  [ -f "$1" ] || die "env file $1 not found"
  fw_clean_pg_env
  out="$(python3 "$HERE/fixture_repair_pgenv.py" "$1" "$WORK" "$2")" \
    || die "could not read a usable DATABASE_URL from $1 (see the message above)"
  eval "$out"
  export PGAPPNAME="fixture-repair-$2"
}

# fw_connect_check: one connection; on failure a value-free reason.
fw_connect_check() {
  if psql -X -Atc "select 1" > /dev/null 2> "$WORK/connect.err"; then return 0; fi
  if grep -qiE "password authentication failed|no password supplied|role .* does not exist|SCRAM" "$WORK/connect.err"; then
    die "the database rejected the user name or password"
  elif grep -qiE "database .* does not exist" "$WORK/connect.err"; then
    die "the database named in the URL does not exist on that server"
  elif grep -qiE "could not translate host name|nodename nor servname|Name or service not known" "$WORK/connect.err"; then
    die "cannot resolve the host name"
  elif grep -qiE "Connection refused|timeout expired|could not connect|Network is unreachable|No route to host" "$WORK/connect.err"; then
    die "cannot reach the host (network, firewall or wrong host/port)"
  else
    die "cannot connect (unrecognised error; not shown because it may contain connection details)"
  fi
}

# fw_server_identity: confirm on the server that we reached what the URL named.
# Database and user always; address and port when the URL host is an IP
# literal (a DNS name such as Render's resolves behind a proxy, where the
# server sees its own internal address, so those are recorded, not compared).
fw_server_identity() {
  local row
  row="$(psql -X -At -F '|' -c "select current_database(), current_user, coalesce(host(inet_server_addr()), ''), coalesce(inet_server_port()::text, '')")"
  SERVER_DATABASE="${row%%|*}"; row="${row#*|}"
  SERVER_USER="${row%%|*}"; row="${row#*|}"
  SERVER_ADDR="${row%%|*}"; SERVER_PORT="${row#*|}"
  [ "$SERVER_DATABASE" = "$PGDATABASE" ] || die "the server says it is database $SERVER_DATABASE, not $PGDATABASE"
  [ "$SERVER_USER" = "$PGUSER" ] || die "the server says the session user is not the URL's user"
  if [ "$FW_HOST_IS_IP" = 1 ]; then
    [ "$SERVER_ADDR" = "$PGHOST" ] || die "the server's address is not the URL's address"
    [ "$SERVER_PORT" = "$PGPORT" ] || die "the server's port is not the URL's port"
  fi
}

# fw_require_host_suffix <suffix>: anchored match on the parsed host name. A
# suffix starting with "." (the default .render.com) needs at least one label
# before it; anything else must equal the host exactly (the local rehearsal).
fw_require_host_suffix() {
  case "$1" in
    .*) case "$PGHOST" in
          ?*"$1") ;;
          *) die "database host is not Render's external host (*$1); use the EXTERNAL url" ;;
        esac ;;
    *) [ "$PGHOST" = "$1" ] || die "database host is not $1" ;;
  esac
}

fw_major() { "$1" --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/'; }

# fw_require_client_major <server major>: pg_dump, pg_restore and psql must be
# exactly the server's major version (a newer client writes SQL an older
# server rejects, e.g. SET transaction_timeout from 17+).
fw_require_client_major() {
  local tool major
  for tool in pg_dump pg_restore psql; do
    major="$(fw_major "$tool")"
    [ "$major" = "$1" ] || die "local $tool is version $major, the server is $1. Install the matching client and use it in this terminal:
    brew install postgresql@$1
    export PATH=\"/opt/homebrew/opt/postgresql@$1/bin:\$PATH\""
  done
}

# fw_scrub: strip anything that looks like a connection string or password.
fw_scrub() {
  sed -E -e 's#postgres(ql)?(\+[a-z0-9]+)?://[^[:space:]]*#<connection string>#g' \
         -e 's#password=[^[:space:]]*#password=<hidden>#g'
}

fw_traps() {
  trap 'rm -rf "$WORK"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
}
