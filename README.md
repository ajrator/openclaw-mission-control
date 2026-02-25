# Mission Control

Mission Control is the web UI for [OpenClaw](https://github.com/openclaw/openclaw): manage agents, tasks, chat, and models in one place. Optional integrations with Notion (task sync) and OpenAI/Codex (chat) can be configured after install.

## Prerequisites

- **Node.js 18+** and npm
- OpenClaw is installed automatically by the installer or by the in-app setup (no separate install required)

## Quick start (one-command install)

Run the install script, then start the app:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/install.sh | bash
cd ~/.openclaw/mission-control && npm run dev
```

Open http://localhost:3000. On first run, complete onboarding: the app will install and start the OpenClaw gateway, then you can create a local account. Notion and OpenAI are optional and can be connected later from Integrations.

> **Security:** Before piping a script from the web to your shell, inspect it (e.g. open the URL in a browser). See [docs/SECURITY.md](docs/SECURITY.md).

## Manual install

1. Create the OpenClaw directory and clone this repo:

   ```bash
   mkdir -p ~/.openclaw
   git clone https://github.com/<owner>/<repo>.git ~/.openclaw/mission-control
   cd ~/.openclaw/mission-control
   ```

2. Run the setup script (installs dependencies, generates `AUTH_SECRET`, bootstraps OpenClaw):

   ```bash
   ./scripts/setup.sh
   ```

3. Start the app and open http://localhost:3000:

   ```bash
   npm run dev
   ```

   Use the onboarding UI to install/start the gateway if needed.

## Configuration

Copy the env template and add at least `AUTH_SECRET`:

```bash
cp .env.example .env.local
```

Generate a secret and add it to `.env.local`:

```bash
npx auth secret
# Paste the output into .env.local as AUTH_SECRET=...
```

Optional variables are documented in [.env.example](.env.example): Notion OAuth, OpenAI OAuth, Google sign-in, and `MISSION_CONTROL_ORIGIN` (if you serve Mission Control from a different origin).

## Running

- **Development:** `npm run dev` — app at http://localhost:3000
- **Production:** `npm run build` then `npm run start`

To run the OpenClaw gateway in a separate terminal (optional; the app can start it via onboarding):

```bash
./scripts/start-gateway.sh
```

## Optional integrations

- **Notion:** Sync tasks with a Notion database. Configure via Integrations in the app (OAuth) or set `NOTION_OAUTH_CLIENT_ID` / `NOTION_OAUTH_CLIENT_SECRET` (or `NOTION_API_KEY` + `NOTION_TASKS_DATABASE_ID`) in `.env.local`.
- **OpenAI (Codex):** Use the Codex model for chat. Configure via Integrations or set `OPENAI_OAUTH_CLIENT_ID` and `OPENAI_OAUTH_CLIENT_SECRET` in `.env.local`, or run `openclaw models auth login --provider openai-codex` in the terminal.

## Security

Setup and gateway install/start behavior, secrets, and recommendations are described in [docs/SECURITY.md](docs/SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
