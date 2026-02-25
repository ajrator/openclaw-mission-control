#!/usr/bin/env bash
# One-command install: clone Mission Control into ~/.openclaw/mission-control and run setup.
# Usage: curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/install.sh | bash
# Override repo: MISSION_CONTROL_REPO_URL=https://github.com/org/repo.git MISSION_CONTROL_BRANCH=main bash -c "$(curl -fsSL ...)"
# Uses $HOME only; no machine-specific paths.

set -e
OPENCLAW_DIR="${HOME}/.openclaw"
MC_DIR="${OPENCLAW_DIR}/mission-control"
# Default repo URL (override with MISSION_CONTROL_REPO_URL)
REPO_URL="${MISSION_CONTROL_REPO_URL:-https://github.com/ajrator/openclaw-mission-control.git}"
BRANCH="${MISSION_CONTROL_BRANCH:-main}"

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
if ! command -v git >/dev/null 2>&1; then
  echo "Mission Control install requires git. Install git and try again."
  exit 1
fi

# Ensure ~/.openclaw exists
mkdir -p "$OPENCLAW_DIR"
chmod 700 "$OPENCLAW_DIR" 2>/dev/null || true

# Clone or update Mission Control
if [ -d "$MC_DIR/.git" ]; then
  echo "Updating existing Mission Control..."
  (cd "$MC_DIR" && git fetch origin && git checkout "$BRANCH" 2>/dev/null || true && git pull origin "$BRANCH" 2>/dev/null || true)
else
  echo "Cloning Mission Control..."
  git clone --branch "$BRANCH" "$REPO_URL" "$MC_DIR"
fi

# Run setup
echo "Running setup..."
"$MC_DIR/scripts/setup.sh"

echo ""
echo "Mission Control is ready. Run:"
echo "  cd ${MC_DIR} && npm run dev"
echo "Then open http://localhost:3000 and use the onboarding UI to start the gateway if needed."
echo ""
