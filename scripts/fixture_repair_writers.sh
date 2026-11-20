#!/usr/bin/env bash
# Pause, resume or check every scheduled workflow that writes to the
# production database, and run one refresh and wait for its real result
# (docs/RUNBOOK-FIXTURE-DUPLICATE-REPAIR.md). Needs `gh` signed in.
#
#   scripts/fixture_repair_writers.sh status
#   scripts/fixture_repair_writers.sh refresh   # dispatch refresh.yml, wait, fail if it fails
#   scripts/fixture_repair_writers.sh pause     # disable all, then verify
#   scripts/fixture_repair_writers.sh resume    # enable all, then verify
#
# keep-warm and smoke only read and are left alone. An external cron calling
# /api/internal/refresh-live (if one is configured) must be paused by hand.
set -euo pipefail

REPO="${FW_REPO:-javohir73/final-whistle}"
WRITERS="refresh.yml odds-snapshots.yml market-intel.yml shadow-record.yml refresh-players.yml refresh-live.yml nrl-refresh.yml nrl-live-refresh.yml"

states() {
  gh workflow list --repo "$REPO" --all --json path,state \
    --jq '.[] | "\(.path | split("/") | last) \(.state)"'
}

check_all() {  # check_all <expected state>
  local listing bad=0 file state
  listing="$(states)"
  for file in $WRITERS; do
    state="$(printf '%s\n' "$listing" | awk -v f="$file" '$1 == f { print $2 }')"
    printf '  %-22s %s\n' "$file" "${state:-missing}"
    [ "$state" = "$1" ] || bad=1
  done
  return "$bad"
}

case "${1:-}" in
  status)
    check_all active || true ;;
  pause)
    for file in $WRITERS; do gh workflow disable "$file" --repo "$REPO"; done
    check_all disabled_manually || { echo "NOT ALL PAUSED" >&2; exit 1; }
    echo "all writers paused" ;;
  resume)
    for file in $WRITERS; do gh workflow enable "$file" --repo "$REPO"; done
    check_all active || { echo "NOT ALL RESUMED" >&2; exit 1; }
    echo "all writers resumed" ;;
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
