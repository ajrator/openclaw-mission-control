#!/usr/bin/env bash
# Mission Control setup: deps, .env.local, OpenClaw doctor.
# Run from repo root: ./scripts/setup.sh
# Uses $HOME only; safe to run multiple times.

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW_DIR="${HOME}/.openclaw"

# Node 18+ and npm
if ! command -v node >/dev/null 2>&1; then
  echo "Mission Control requires Node.js. Install Node 18+ from https://nodejs.org and try again."
  exit 1
fi
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
  echo "Mission Control requires Node.js 18 or later. Current: $(node -v)"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Mission Control requires npm. Install Node.js from https://nodejs.org and try again."
  exit 1
fi

# Ensure ~/.openclaw exists
if [ ! -d "$OPENCLAW_DIR" ]; then
  mkdir -p "$OPENCLAW_DIR"
  chmod 700 "$OPENCLAW_DIR" 2>/dev/null || true
fi

# Install dependencies
echo "Installing dependencies..."
cd "$REPO_ROOT"
npm install

# .env.local + AUTH_SECRET
if [ ! -f "$REPO_ROOT/.env.local" ]; then
  if [ -f "$REPO_ROOT/.env.example" ]; then
    cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env.local"
    echo "Created .env.local from .env.example"
  fi
fi
if [ -f "$REPO_ROOT/.env.local" ] && ! grep -q '^AUTH_SECRET=.\+' "$REPO_ROOT/.env.local" 2>/dev/null; then
  SECRET=$(cd "$REPO_ROOT" && npx auth secret 2>/dev/null | tail -1)
  if [ -n "$SECRET" ]; then
    (grep -v '^AUTH_SECRET=' "$REPO_ROOT/.env.local" 2>/dev/null; echo "AUTH_SECRET=$SECRET") > "$REPO_ROOT/.env.local.tmp"
    mv "$REPO_ROOT/.env.local.tmp" "$REPO_ROOT/.env.local"
    echo "Added AUTH_SECRET to .env.local"
  else
    echo "Could not generate AUTH_SECRET. Run: npx auth secret"
    echo "Then add AUTH_SECRET=... to .env.local"
  fi
fi

# Bootstrap OpenClaw config (safe for fresh and existing users)
echo "Running OpenClaw doctor..."
(cd "$OPENCLAW_DIR" && npx openclaw@latest doctor) || true

echo ""
echo "Setup complete. Next steps:"
echo "  1. cd $REPO_ROOT && npm run dev"
echo "  2. Open http://localhost:3000"
echo "  3. Use the onboarding UI to start the gateway if needed"
echo ""
