#!/usr/bin/env bash
# Start the OpenClaw gateway (foreground). Optional alternative to starting from the Mission Control UI.
# Uses $HOME only.

set -e
OPENCLAW_DIR="${HOME}/.openclaw"
if [ ! -d "$OPENCLAW_DIR" ]; then
  echo "OpenClaw directory not found: $OPENCLAW_DIR"
  echo "Run Mission Control setup first (e.g. ./scripts/setup.sh or use the in-app onboarding)."
  exit 1
fi
cd "$OPENCLAW_DIR"
exec npx openclaw@latest gateway
