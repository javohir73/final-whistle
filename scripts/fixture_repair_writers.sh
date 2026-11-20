#!/usr/bin/env bash
# Pause, resume or check every scheduled workflow that writes to the
# production database, and run one refresh and wait for its real result
# (docs/RUNBOOK-FIXTURE-DUPLICATE-REPAIR.md). Needs `gh` signed in.
#
#   scripts/fixture_repair_writers.sh status    # current states, and drift from the record
#   scripts/fixture_repair_writers.sh refresh   # dispatch refresh.yml, wait, fail if it fails
#   scripts/fixture_repair_writers.sh pause     # record states, disable the active ones, verify
#   scripts/fixture_repair_writers.sh resume    # re-enable exactly what was active, verify
#
# `pause` writes the states it found to $FW_WRITERS_STATE (default
# ~/fw-backups/writers-state.txt) and prints them; a second `pause` (e.g. after
# a half-finished run) keeps the FIRST record, so nothing that pause itself
# disabled is ever recorded as "was disabled". `resume` enables only workflows
# recorded as active and currently not active, verifies every workflow is back
# in its recorded state, then archives the record. Both are safe to re-run.
#
# gh only resolves an active workflow for `disable` and a disabled one for
# `enable` (pkg/cmd/workflow/{disable,enable}: ResolveWorkflow with
# []WorkflowState{Active} / {DisabledManually, DisabledInactivity}); calling
# either on a workflow already in the target state fails. So each call is
# made only for workflows that need it.
#
# keep-warm and smoke only read and are left alone. An external cron calling
# /api/internal/refresh-live (if one is configured) must be paused by hand.
set -euo pipefail

REPO="${FW_REPO:-javohir73/final-whistle}"
STATE_FILE="${FW_WRITERS_STATE:-$HOME/fw-backups/writers-state.txt}"
WRITERS="refresh.yml odds-snapshots.yml market-intel.yml shadow-record.yml refresh-players.yml refresh-live.yml nrl-refresh.yml nrl-live-refresh.yml"

# "<file> <state>" for every writer, from one API call.
current_states() {
  gh workflow list --repo "$REPO" --all --json path,state --limit 200 \
    | python3 -c '
import json, sys
states = {w["path"].rsplit("/", 1)[-1]: w["state"] for w in json.load(sys.stdin)}
for name in sys.argv[1:]:
    print(name, states.get(name, "missing"))
' $WRITERS
}

state_of() { printf '%s\n' "$1" | awk -v f="$2" '$1 == f { print $2 }'; }
is_active() { if [ "$1" = active ]; then echo yes; else echo no; fi; }

show() {  # show <current listing> [<recorded listing>]
  local file now was mark
  for file in $WRITERS; do
    now="$(state_of "$1" "$file")"
    if [ -n "${2:-}" ]; then
      was="$(state_of "$2" "$file")"
      mark=""
      if [ "$(is_active "$now")" != "$(is_active "$was")" ]; then mark="  <-- differs"; fi
      printf '  %-22s now %-20s recorded %-20s%s\n' "$file" "$now" "$was" "$mark"
    else
      printf '  %-22s %s\n' "$file" "$now"
    fi
  done
}

case "${1:-}" in
  status)
    NOW="$(current_states)"
    if [ -f "$STATE_FILE" ]; then
      # While paused every writer should be off; "recorded" is what resume restores.
      echo "paused (record in $STATE_FILE); any writer marked differs is running again:"
      PAUSED=""
      for file in $WRITERS; do PAUSED="$PAUSED$file disabled_manually
"; done
      show "$NOW" "$PAUSED"
      echo "states resume will restore:"; show "$(cat "$STATE_FILE")"
    else
      echo "not paused (no record):"; show "$NOW"
    fi ;;
  pause)
    NOW="$(current_states)"
    if printf '%s\n' "$NOW" | grep -q ' missing$'; then
      echo "a writer workflow was not found:" >&2; show "$NOW" >&2; exit 1
    fi
    mkdir -p "$(dirname "$STATE_FILE")"
    if [ -f "$STATE_FILE" ]; then
      echo "keeping the earlier record (a previous pause did not finish with resume):"
    else
      printf '%s\n' "$NOW" > "$STATE_FILE"
      echo "recorded the states before pausing in $STATE_FILE:"
    fi
    show "$NOW" "$(cat "$STATE_FILE")"
    for file in $WRITERS; do
      if [ "$(state_of "$NOW" "$file")" = active ]; then
        gh workflow disable "$file" --repo "$REPO"
      fi
    done
    AFTER="$(current_states)"
    if printf '%s\n' "$AFTER" | grep -q ' active$'; then
      echo "NOT ALL PAUSED:" >&2; show "$AFTER" >&2; exit 1
    fi
    echo "all writers paused" ;;
  resume)
    [ -f "$STATE_FILE" ] || { echo "no record of a pause at $STATE_FILE; nothing to resume" >&2; exit 1; }
    RECORD="$(cat "$STATE_FILE")"
    NOW="$(current_states)"
    for file in $WRITERS; do
      if [ "$(state_of "$RECORD" "$file")" = active ] && [ "$(state_of "$NOW" "$file")" != active ]; then
        gh workflow enable "$file" --repo "$REPO"
      fi
    done
    AFTER="$(current_states)"
    BAD=0
    for file in $WRITERS; do
      was="$(state_of "$RECORD" "$file")"; now="$(state_of "$AFTER" "$file")"
      if [ "$(is_active "$was")" != "$(is_active "$now")" ]; then BAD=1; fi
    done
    show "$AFTER" "$RECORD"
    [ "$BAD" = 0 ] || { echo "NOT BACK TO THE RECORDED STATES" >&2; exit 1; }
    mv "$STATE_FILE" "$STATE_FILE.resumed-$(date -u +%Y%m%dT%H%M%SZ)"
    echo "writers back to the states recorded at pause" ;;
  refresh)
    started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    gh workflow run refresh.yml --repo "$REPO" --ref main
    run_id=""
    for _ in $(seq 1 30); do
      # Only a run created after this dispatch counts (never an older one).
      run_id="$(gh run list --repo "$REPO" --workflow refresh.yml --event workflow_dispatch \
        --limit 10 --json databaseId,createdAt \
        --jq "[.[] | select(.createdAt >= \"$started\")] | sort_by(.createdAt) | last | .databaseId // empty")"
      [ -n "$run_id" ] && break
      sleep 2
    done
    [ -n "$run_id" ] || { echo "could not find the dispatched refresh run" >&2; exit 1; }
    echo "watching refresh run $run_id"
    gh run watch "$run_id" --repo "$REPO" --exit-status
    echo "refresh run $run_id succeeded" ;;
  *)
    echo "usage: $0 status|refresh|pause|resume" >&2; exit 2 ;;
esac
