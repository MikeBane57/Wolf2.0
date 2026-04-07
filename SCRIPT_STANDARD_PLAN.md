# Wolf 2.0 userscript standardization

Conventions for scripts used with **DonkeyCODE** and the ops suite (`opssuitemain.swacorp.com`). Details below are aligned with DonkeyCODE’s loader (`parseUserScript` in `background.js`): only certain headers are parsed; the rest are optional documentation.

## Goals

- One `.user.js` file per feature (users can enable or disable individually).
- Consistent headers and structure for review and maintenance.
- Default scope: `https://opssuitemain.swacorp.com/*`; use a **narrower** `@match` when a script only applies to one area (e.g. `.../operational-dashboard*`).

## DonkeyCODE: what the loader actually reads

From `parseUserScript` (and related logic in `background.js`):

| Header | Effect |
|--------|--------|
| `@name` | Parsed; used for display. (Listing / filename still matters for which files load.) |
| `@match` | Parsed; Tampermonkey-style patterns. If **none**, default is `*://*/*`. |
| `@exclude` | Parsed; stored as excludes. |
| `@grant` | Only used to enable **`GM_xmlhttpRequest`** (normalized to `xmlhttprequest`, or code contains `GM_xmlhttpRequest`). Other grants are not implemented. |
| `@connect` | Parsed; host allowlist for `GM_xmlhttpRequest` (empty ⇒ allow all hosts for connect checks, per implementation). |

**Not parsed by the loader** (safe to keep for humans or Tampermonkey; DonkeyCODE ignores):

- `@include`, `@namespace`, `@version`, `@description`
- `@run-at` (injection is after load complete / tab sync)
- `@updateURL`, `@downloadURL`
- `@require`, `@resource`

## DonkeyCODE: APIs and storage

- **`GM_xmlhttpRequest` only** — no `GM_getValue`, `GM_setValue`, `GM_addStyle`, `unsafeWindow`, etc.
- **Page** `fetch` runs in the page world (CORS / page CSP apply).
- **Cross-origin from the extension path** — use `GM_xmlhttpRequest` with appropriate `@connect` and user permission for `http(s)://*/*` when required.
- **Storage** — use **`localStorage` / `sessionStorage`** on the target origin (no GM storage API).

Optional cleanup: define a global **`__myScriptCleanup`** if the script needs teardown (see `donkeycodeInjectMain`).

## Updates (DonkeyCODE)

**`@updateURL` / `@downloadURL` are not used.** Scripts update when the extension **re-fetches** them from:

- The configured **GitHub Contents API** listing (e.g. Wolf2.0 `*.user.js` files), and/or  
- **Extra raw URLs** in settings,

then saves to extension storage. Refresh runs on install, startup, ~daily alarm, and manual “Refresh scripts”.  

Repo scripts may still include `@updateURL` / `@downloadURL` for **Tampermonkey** users or documentation; DonkeyCODE ignores them.

## Repo header conventions (Wolf 2.0)

| Item | Convention |
|------|------------|
| Opening/closing | `// ==UserScript==` and `// ==/UserScript==` (space after `//`) |
| First line of file | No leading blank line before the opening tag |
| `@namespace` | Keep `Wolf 2.0` (documentation; DonkeyCODE ignores) |
| `@version`, `@description` | Recommended for humans; DonkeyCODE ignores |
| `@grant` | Omit unless the script needs **`GM_xmlhttpRequest`**; then `@grant GM_xmlhttpRequest` and list hosts in `@connect` |
| `@updateURL` / `@downloadURL` | Optional; point at Wolf2.0 raw URLs if you want Tampermonkey parity or a clear canonical URL — **not** used by DonkeyCODE for sync |
| Body | IIFE: `(function() { 'use strict'; ... })();` |
| Dynamic UI | Prefer `MutationObserver` on `document.body` when the app adds nodes after load |

## Template

Copy `templates/userscript.template.user.js` when starting a new script.

## Changelog

- Initial plan and template; header fixes on two scripts.
- Filled DonkeyCODE section from `background.js` / `bridge.js` / `manifest.json` report (parser fields, GM XHR only, updates via listing, storage).
