# Wolf 2.0

Collection of 13 Tampermonkey userscripts (`.user.js`) that enhance the Southwest Airlines internal Ops Suite at `opssuitemain.swacorp.com`.

## Cursor Cloud specific instructions

### Architecture

This is **not** a traditional application — there is no backend, no build step, and no framework. Each `.user.js` file is a standalone browser userscript that injects into the Ops Suite DOM via Tampermonkey/Greasemonkey.

### Development commands

| Task | Command |
|------|---------|
| Lint | `npm run lint` |
| Lint + autofix | `npm run lint:fix` |
| Syntax validation | `npm run validate` |
| Dev server (test harness) | `npm run dev` → open `http://localhost:8080/dev-tools/test-harness.html` |

### Key caveats

- **Cannot test end-to-end without corporate access.** All scripts `@match` against `https://opssuitemain.swacorp.com/*`, which requires Southwest Airlines VPN/network access. The test harness (`dev-tools/test-harness.html`) simulates enough DOM structure to load and syntax-check scripts in a browser context.
- **Pre-existing syntax error.** `Flight Tooltip Dynamic Parser.user.js` has a known parse error at line 202 (unexpected `}`). It will fail both `npm run validate` and ESLint.
- **No build step.** Edit `.user.js` files directly; there is no transpilation or bundling.
- **Greasemonkey globals.** ESLint config includes `GM_xmlhttpRequest`, `GM_addStyle`, etc. as known globals. If new GM_ APIs are used, add them to `eslint.config.mjs` → `globals`.
