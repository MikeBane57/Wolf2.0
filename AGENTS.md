# Wolf 2.0 + DonkeyCODE

This workspace contains two projects:

1. **Wolf 2.0** (root) — 13 Tampermonkey userscripts (`.user.js`) that enhance the Southwest Airlines internal Ops Suite at `opssuitemain.swacorp.com`.
2. **DonkeyCODE** (submodule at `DonkeyCODE/`) — A Chrome Manifest V3 extension that acts as a lightweight userscript loader with session management.

## Cursor Cloud specific instructions

### Architecture

- **Wolf 2.0 userscripts:** Standalone `.user.js` files in the repo root. No build step, no framework. Each injects into the Ops Suite DOM via Tampermonkey/Greasemonkey (or DonkeyCODE).
- **DonkeyCODE extension:** Chrome extension in `DonkeyCODE/DonkeyCode/` with `manifest.json`. Has a build step (`npm run build` inside `DonkeyCODE/`) that generates `baked-config.js` from env vars. The extension can be loaded unpacked in Chrome from `DonkeyCODE/DonkeyCode/`.

### Development commands — Wolf 2.0 (repo root)

| Task | Command |
|------|---------|
| Lint | `npm run lint` |
| Lint + autofix | `npm run lint:fix` |
| Syntax validation | `npm run validate` |
| Dev server (test harness) | `npm run dev` → open `http://localhost:8080/dev-tools/test-harness.html` |

### Development commands — DonkeyCODE (`DonkeyCODE/`)

| Task | Command |
|------|---------|
| Build (generate baked-config.js) | `cd DonkeyCODE && npm run build` |
| Load in Chrome | chrome://extensions → Developer mode → Load unpacked → select `DonkeyCODE/DonkeyCode/` |

See `DonkeyCODE/BUILD.md` for full build instructions including GitHub token baking.

### Key caveats

- **Cannot test Wolf 2.0 end-to-end without corporate access.** All scripts `@match` against `https://opssuitemain.swacorp.com/*`, which requires Southwest Airlines VPN/network access. The test harness (`dev-tools/test-harness.html`) simulates enough DOM structure to load and syntax-check scripts in a browser context.
- **Pre-existing syntax error.** `Flight Tooltip Dynamic Parser.user.js` has a known parse error at line 202 (unexpected `}`). It will fail both `npm run validate` and ESLint.
- **No build step for userscripts.** Edit `.user.js` files directly; there is no transpilation or bundling.
- **DonkeyCODE is a git submodule.** After cloning, run `git submodule update --init` to fetch it. The build step (`npm run build` in `DonkeyCODE/`) can run without env vars — it copies the template config (users enter token in Settings UI instead).
- **DonkeyCODE baked-config.js is gitignored.** It's generated at build time and may contain secrets. Never commit it.
- **Greasemonkey globals.** ESLint config includes `GM_xmlhttpRequest`, `GM_addStyle`, etc. as known globals. If new GM_ APIs are used, add them to `eslint.config.mjs` → `globals`.
