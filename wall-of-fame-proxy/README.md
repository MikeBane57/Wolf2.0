# Wall of Fame proxy (GitHub App + team key)

Small HTTP service so **DonkeyCODE users** can sync `WALL of FAME/wall-of-fame.json` with a **shared team key** in prefs, while **GitHub App credentials** (private key) stay **only on the server**.

## What you create on GitHub

1. **GitHub App** (Organization or user → Settings → Developer settings → GitHub Apps → New).
   - **Webhook:** inactive (uncheck) if you only use REST from this proxy.
   - **Repository permissions → Contents:** Read and write.
   - **Where can this GitHub App be installed?** Only on this account, or any account you need.

2. **Install the app** on `MikeBane57/Wolf2.0` (or your fork). Note the **installation ID** from the URL:  
   `https://github.com/settings/installations/<INSTALLATION_ID>`.

3. **Generate a private key** for the app (PEM). You will set `GITHUB_APP_PRIVATE_KEY` to its contents (escape newlines as `\n` in `.env` if needed).

4. Note the **App ID** (numeric) on the app settings page.

5. Create a long random **team key** (shared secret). Everyone on the team puts the same key in DonkeyCODE **`wallOfFameTeamKey`**. Rotate if it leaks.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WOF_TEAM_KEY` | Yes | Shared secret; clients send `X-Wall-Of-Fame-Key`. |
| `GITHUB_APP_ID` | Yes | App ID. |
| `GITHUB_APP_INSTALLATION_ID` | Yes | Installation ID for the repo. |
| `GITHUB_APP_PRIVATE_KEY` | Yes | PEM private key (use `\n` for newlines in env). |
| `PORT` | No | Default `8787`. |
| `WOF_GITHUB_OWNER` | No | Default `MikeBane57`. |
| `WOF_GITHUB_REPO` | No | Default `Wolf2.0`. |
| `WOF_GITHUB_BRANCH` | No | Default `main`. |
| `WOF_FILE_PATH` | No | Default `WALL of FAME/wall-of-fame.json`. |

## Run locally

```bash
cd wall-of-fame-proxy
npm install
export WOF_TEAM_KEY='your-long-random-secret'
export GITHUB_APP_ID='123456'
export GITHUB_APP_INSTALLATION_ID='12345678'
export GITHUB_APP_PRIVATE_KEY="$(cat /path/to/app-private-key.pem)"
node server.js
```

## API

- `GET /health` — no auth; for load balancers.
- `GET /wall-of-fame` — header `X-Wall-Of-Fame-Key: <team key>`. Returns the raw JSON file body.
- `PUT /wall-of-fame` — same header; body `{ "entries": [...], "updatedAt": number }`.

Deploy behind **HTTPS** in production. Add your proxy base URL to DonkeyCODE **`wallOfFameProxyUrl`** (e.g. `https://wof.yourcompany.com`).

## Userscript prefs

- **`wallOfFameProxyUrl`** — HTTPS base URL of this service (no trailing slash required).
- **`wallOfFameTeamKey`** — same value as `WOF_TEAM_KEY`.

If both are set, the script uses the proxy. Otherwise the userscript uses the **same `donkeycode_github_*` keys as DonkeyCODE session sync** (extension settings PAT) — no separate userscript PAT.
