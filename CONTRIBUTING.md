# Contributing

## Git branches

- **Ship work on `main`.** Merge or push completed changes to `main` so the repo’s default branch always reflects what users should run.
- **If you need a non-`main` branch** (experiments, pre-release checks, or anything that should not land on `main` yet), use **`test`** only.
- **Do not use long-lived `cursor/…` (or similar agent-specific) branches** for ongoing work. Prefer `main` or `test` as above.

This keeps DonkeyCODE userscripts and automation aligned with a simple two-branch model: production on `main`, optional staging on `test`.
