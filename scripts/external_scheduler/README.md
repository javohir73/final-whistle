# External scheduler

GitHub starts this repo's scheduled workflows hours late and drops most of them: through
November 2026 the hourly `odds-snapshots` ran 3 to 5 times a day and the 06:00 UTC
`refresh-data` started between 13:00 and 15:30 UTC. `scheduler.py` triggers the
time-sensitive workflows on time from an always-on Mac instead.

## What it does

launchd runs `scheduler.py` once a minute. Each run:

| Job | When (UTC) | How |
| --- | --- | --- |
| `refresh-live.yml` | `7 */2 * * *` | `workflow_dispatch` on `main` |
| `odds-snapshots.yml` | `17 * * * *` | `workflow_dispatch` on `main` |
| `nrl-live-refresh.yml` | `*/15 0-12 * 3-10 0,1,4,5,6` | `workflow_dispatch` on `main` |
| keep-warm | every 10 minutes | plain `GET /api/health` on the API, no Actions run |

- It uses the machine's existing `gh` login (scopes `repo`, `workflow`). It stores no secrets;
  the workflows keep reading theirs from GitHub.
- The `schedule:` blocks stay in the workflows as a fallback. A slot is skipped when any run of
  that workflow started within half a period before it, so GitHub's late runs and these do not
  double up.
- A slot missed by more than 20 minutes (machine off, GitHub unreachable) is not replayed.
- The once-a-day workflows (`refresh-data`, `market-intel`, `shadow-record`, `refresh-players`,
  `nrl-refresh`) and `smoke` are not handled here; they stay on GitHub's schedule.

The crons live in `DISPATCH_JOBS` in `scheduler.py`. A test fails if they differ from the
workflow files, so change both together and re-run `install.sh`.

## Install, pause, remove

```sh
scripts/external_scheduler/install.sh              # copies to ~/.fw-scheduler and starts it
touch ~/.fw-scheduler/PAUSED                       # pause; rm the file to resume
/usr/bin/python3 ~/.fw-scheduler/scheduler.py status
tail ~/.fw-scheduler/scheduler.log
scripts/external_scheduler/install.sh --uninstall
```

Disabling a workflow on GitHub (as `scripts/fixture_repair_writers.sh pause` does) also stops
it here: the dispatch is refused and logged, and nothing runs.

## Limits

- It only runs while the Mac is on and its user is logged in. After a power cut nothing is
  dispatched until someone logs in; GitHub's own schedule is the only cover until then.
- Minutes: free while the repo is public. If the repo goes private again, running these three
  workflows at their full cadence will use more of the 2,000 free minutes than GitHub's patchy
  schedule did. Re-size the crons first.
