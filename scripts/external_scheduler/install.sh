#!/bin/bash
# Install (or remove) the on-time workflow trigger as a per-user launchd agent.
#   ./install.sh              copy scheduler.py to ~/.fw-scheduler and start it
#   ./install.sh --uninstall  stop it and remove the agent (state and log are kept)
# Needs: macOS, the system python3, and `gh` signed in with the `repo` and `workflow` scopes.
set -euo pipefail

LABEL="com.finalwhistle.scheduler"
DEST="$HOME/.fw-scheduler"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
HERE="$(cd "$(dirname "$0")" && pwd)"
GH_BIN="${FW_SCHEDULER_GH:-$(command -v gh || true)}"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$PLIST"
  echo "Removed $LABEL. $DEST (state, log) left in place."
  exit 0
fi

[ -x "$GH_BIN" ] || { echo "gh not found; set FW_SCHEDULER_GH" >&2; exit 1; }
"$GH_BIN" auth status >/dev/null 2>&1 || { echo "gh is not signed in" >&2; exit 1; }

mkdir -p "$DEST" "$(dirname "$PLIST")"
cp "$HERE/scheduler.py" "$DEST/scheduler.py"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DEST/scheduler.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FW_SCHEDULER_GH</key><string>$GH_BIN</string>
  </dict>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$DEST/scheduler.log</string>
  <key>StandardErrorPath</key><string>$DEST/scheduler.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $LABEL. Log: $DEST/scheduler.log"
echo "Pause: touch $DEST/PAUSED    Resume: rm $DEST/PAUSED"
echo "Status: /usr/bin/python3 $DEST/scheduler.py status"
