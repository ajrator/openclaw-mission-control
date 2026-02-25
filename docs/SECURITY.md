# Security: Mission Control setup and onboarding

This document describes the threat model and safeguards for the Mission Control setup flow (gateway detect, install, start), the one-command install script, and onboarding.

## One-command install script

The recommended install command pipes a script from the web to your shell (e.g. `curl -fsSL <url>/scripts/install.sh | bash`). **You should inspect the script before running it**: open the script URL in a browser and review what it does. The script only: checks for Node/npm/git, creates `$HOME/.openclaw`, clones the Mission Control repo (from a default or `MISSION_CONTROL_REPO_URL`), and runs `scripts/setup.sh`. It does not execute arbitrary or user-supplied commands; repo URL can be overridden via environment variable for forks.

## Install / start surface

- **What runs**: The app only executes fixed, well-defined commands. No user-supplied or remote scripts are executed.
  - **Install** (`POST /api/setup/gateway/install`): Ensures `~/.openclaw` exists, then runs `npx openclaw@latest doctor`. If config is still missing, the app writes a minimal `openclaw.json` with generated token and loopback-only gateway. No arbitrary shell or download URLs.
  - **Start** (`POST /api/setup/gateway/start`): Runs `npx openclaw@latest gateway` in a detached process. No arguments from the client.
- **Integrity**: If the app later adds downloading an OpenClaw binary (e.g. for Electron), downloads must use HTTPS and verify checksums or signatures. Current flow uses only `npx openclaw@latest` (npm registry integrity).
- **Recommendation for Electron**: If packaging as a standalone app, prefer a bundled OpenClaw binary or a fixed path `node`/binary rather than executing `npx` from the network at runtime.

## Secrets

- **OAuth**: Notion and OpenAI OAuth credentials and tokens are not stored in `mission-control.json`. They remain in env vars (for OAuth client id/secret), `~/.openclaw/notion-integration.json` (Notion OAuth), and `~/.openclaw/agents/*/agent/auth-profiles.json` (OpenAI Codex profile). The onboarding wizard only triggers redirects to existing OAuth routes; it does not handle or persist tokens itself.
- **Gateway token**: If the app creates a minimal `openclaw.json` during install, it generates a random token with `crypto.randomBytes(24)`. The file is written with mode `0o600`. The token is stored only in `openclaw.json` and is used by the gateway for Control UI auth.

## Gateway defaults (when app writes config)

- **Bind**: `bind: 'loopback'` so the gateway listens only on localhost.
- **Auth**: Token auth with the generated token.
- **Control UI**: `controlUi.allowedOrigins` is set to a single origin (`MISSION_CONTROL_ORIGIN` or `http://localhost:3000`). Mission Control must be served from that origin for chat to work. We set `dangerouslyDisableDeviceAuth: true` in the minimal config so the Control UI (chat) can connect with token auth only; this is documented as required for local-only deployment where no device auth flow is used.

## Read-only checks before install/start

- **Status** (`GET /api/setup/gateway/status`): Only reads `~/.openclaw/openclaw.json` (via `getGatewayUrl()`) and performs an HTTP GET to the gateway URL to see if it is reachable. No writes, no execution.
- Install and start are triggered only by explicit user action in the onboarding wizard (e.g. "Install and start" button).

## Persistence

- **Onboarding state**: Stored in `~/.openclaw/mission-control.json` (`onboardingCompletedAt`, optional `onboardingSkippedNotion`, `onboardingSkippedOpenAI`). No secrets in this file. The file is created with restrictive permissions where possible (`0o600` for the prefs file in `writeMissionControlPrefs`).

## Summary

| Area            | Mitigation |
|-----------------|------------|
| Install/start   | Fixed commands only (`npx openclaw@latest doctor`, `npx openclaw@latest gateway`); no user input in executed commands. |
| Secrets         | OAuth and gateway token stay in existing locations; onboarding does not store new secrets. |
| Gateway exposure| Loopback-only bind; token auth; single allowed origin. |
| Distribution    | Future downloads must use HTTPS and integrity verification. |
