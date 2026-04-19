# Sync via GitHub Actions + repository secret

Browser code **cannot** read **repository secrets**. The pattern:

1. **Admin** adds secret **`WOF_TEAM_KEY`** (repo → Settings → Secrets and variables → Actions). Use a long random value.
2. **Team** uses the **same** value in DonkeyCODE as **`wallOfFameTeamKey`** (shared password, not the GitHub PAT).
3. **Enable** **`wallOfFameUseGithubActions`** in the Wall of Fame script prefs.
4. **PAT** still required in DonkeyCODE session sync (**`donkeycode_github_pat`**) so the script can call **`repository_dispatch`** (needs write access to the repo). The PAT is **not** stored in the repo; it stays in the extension like session sync.

The workflow **`.github/workflows/wall-of-fame-sync.yml`** compares `client_payload.team_key` to **`secrets.WOF_TEAM_KEY`**, then commits **`WALL of FAME/wall-of-fame.json`** with `GITHUB_TOKEN`.

**Fetch:** the script reads the public raw file  
`https://raw.githubusercontent.com/<owner>/<repo>/<branch>/WALL%20of%20FAME/wall-of-fame.json`  
(no token if the repo is public). Private repos need a PAT and fall back to the Contents API for GET.

**Limits:** `repository_dispatch` `client_payload` must stay under GitHub’s payload size limits (~65KB per field).
