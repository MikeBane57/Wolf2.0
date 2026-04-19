# Sync via GitHub Actions + repository secret

Browser code **cannot** read **repository secrets**. The pattern:

1. **Admin** adds secret **`WOF_TEAM_KEY`** (repo → Settings → Secrets and variables → Actions). Use a long random value.
2. **Team** uses the **same** value in DonkeyCODE as **`wallOfFameTeamKey`** (shared password, not the GitHub PAT).
3. **Enable** **`wallOfFameUseGithubActions`** in the Wall of Fame script prefs.
4. **PAT** still required in DonkeyCODE session sync (**`donkeycode_github_pat`**) so the script can call **`repository_dispatch`** (needs write access to the repo). The PAT is **not** stored in the repo; it stays in the extension like session sync.

The workflow **`.github/workflows/wall-of-fame-sync.yml`** compares `client_payload.team_key` to **`secrets.WOF_TEAM_KEY`**, then commits **`WALL of FAME/wall-of-fame.json`** with `GITHUB_TOKEN`.

**Path:** default file is **`WALL of FAME/wall-of-fame.json`**. If session sync uses a different sessions root, set userscript pref **`wallOfFameRepoPath`** so fetch/dispatch match the file on disk (we no longer derive from `donkeycode_github_sessions_root`).

**Fetch:** raw URL built from owner/repo/branch + that path. Private repo needs PAT for Contents API fallback.

**Publish:** `repository_dispatch` body must be sent as **JSON string** in `GM_xmlhttpRequest` `data` (DonkeyCODE must forward body).

**Limits:** `repository_dispatch` `client_payload` must stay under GitHub’s payload size limits (~65KB per field).
