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

### `GM_xmlhttpRequest` checklist (cross-origin / GitHub)

Use this only for scripts that actually need cross-origin HTTP (e.g. a custom `GM_xmlhttpRequest` integration). **SOD Wall of Fame** in this repo is **local-only** and does not post to Git or call `GM_xmlhttpRequest`.

Scripts that call **`GM_xmlhttpRequest`** (e.g. GitHub REST API) need all of the following in DonkeyCODE:

| Requirement | Notes |
|-------------|--------|
| **`@grant GM_xmlhttpRequest`** | Or the script body references `GM_xmlhttpRequest` so the bridge enables. |
| **`@connect`** | **Empty list** ⇒ DonkeyCODE allows any http(s) host for the connect check. **`*`** ⇒ same (“allow all” for that layer). Otherwise list hostnames (e.g. `api.github.com`) or `*.example.com` for subdomains. |
| **Site / host permission** | User must grant DonkeyCODE **optional** “website access” (**`http://*/*`** + **`https://*/*`**). The background `fetch` path only checks that grant; without it, requests fail with a **“Host permission not granted…”** style error even for `https://api.github.com`. |
| **Prefs** | Use **`@donkeycode-pref`** string (etc.) fields and read with **`donkeycodeGetPref("key")`**. Injection is **`new Function("donkeycodeGetPref", …)`** and optionally **`GM_xmlhttpRequest`** — see **`DonkeyCode/DONKEYCODE_SCRIPT_PREFS_AGENT.md`**. |
| **GitHub auth** | Classic PAT or fine-grained token with **Contents: Read and write** on the repo (and path, for fine-grained). DonkeyCODE does **not** add OAuth for arbitrary userscripts; the token is whatever the user stores in prefs. |

**Calling GitHub’s REST API (PUT/POST):** set **`headers`** to include **`Authorization`**, **`Accept`**: `application/vnd.github+json`, **`Content-Type`**: `application/json`, **`X-GitHub-Api-Version`**: `2022-11-28` (or current). Pass the JSON body in **`data`**: either **`JSON.stringify({ ... })`** or a **plain object** (DonkeyCODE may stringify objects). Same pattern for **`body`** if your bridge accepts Tampermonkey-style `body`. Older DonkeyCODE builds that never forward `data`/`body` will fail PUT/Publish until updated.

**Debugging:** Chrome/Edge → extension → **Service worker** → **Inspect** → Console. Look for **`GM_xmlhttpRequest`**, **`GM_XHR blocked by @connect`**, **`GM_XHR blocked (no host permission)`**, **`GM_xmlhttpRequest fetch failed`**. Page scripts can use the extension’s **page → service worker log** path (`DONKEYCODE_PAGE_LOG` / `bridge.js`) so logs appear in the background console.

### Teardown (`__myScriptCleanup`)

DonkeyCODE calls **`window.__myScriptCleanup()`** when a script is **disabled** or before **re-injecting** after pref changes. Assign a **no-arg** function that:

- **`disconnect()`** any `MutationObserver`s
- **`clearInterval` / `clearTimeout`** for timers you created
- **`removeEventListener`** using the **same function reference** you passed to `addEventListener`
- **Remove** injected DOM nodes (toolbars, overlays) and **restore** `document.title` / critical styles if feasible

If cleanup is missing, toggling the script off leaves listeners and DOM changes until a **full page reload**.

## Updates (DonkeyCODE)

**`@updateURL` / `@downloadURL` are not used.** Scripts update when the extension **re-fetches** them from:

- The configured **GitHub Contents API** listing (e.g. Wolf2.0 `*.user.js` files), and/or  
- **Extra raw URLs** in settings,

then saves to extension storage. Refresh runs on install, startup, ~daily alarm, and manual “Refresh scripts”.  

Repo scripts may still include `@updateURL` / `@downloadURL` for **Tampermonkey** users or documentation; DonkeyCODE ignores them.

## DonkeyCODE: user preferences (`@donkeycode-pref`)

See **`DonkeyCode/DONKEYCODE_SCRIPT_PREFS_AGENT.md`** in the DonkeyCODE repo for the full schema. Summary for Wolf2.0 authors:

### Grouped Pref UI

- Each field spec may include **`"group": "Section name"`** (e.g. `"Go Turn Details"`).
- Keys **without** `group` appear under **General** (first).
- Other groups are sorted **A→Z**. Each group has a **section heading**, then its fields (sorted by **key** within the group).
- Headings use the class **`.script-prefs-group-heading`**.

### Runtime injection and `donkeycodeGetPref`

- The extension runs script bodies as **`new Function("donkeycodeGetPref", code)`** (and **`GM_xmlhttpRequest`** when granted), then **`run(donkeycodeGetPref, …)`** with a closure from **saved user prefs + schema**.
- **`donkeycodeGetPref` is also set on `window` / `globalThis`** for the injection lifetime, so these all work:
  - **`globalThis.donkeycodeGetPref("key")`** inside parameterless IIFEs and async callbacks
  - **`(function (donkeycodeGetPref) { … })(globalThis.donkeycodeGetPref)`** — safe **after** injection when the global is set
- If **multiple** scripts run on the same page, **the last injected script** wins for **`globalThis.donkeycodeGetPref`** (per DonkeyCODE docs).
- **Debug:** when at least one pref key is saved, the **page** console logs  
  **`[DonkeyCode:page] applying saved prefs <scriptId> <object>`**.

### Session folder (important)

- Use a **named session folder** in DonkeyCODE (not **Default**) if you want **stored script prefs** to load and (where configured) **sync** — **Default** does not use stored script prefs the same way.

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
- Documented `@donkeycode-pref`: grouped UI, `globalThis.donkeycodeGetPref`, debug log, named session folder vs Default.
- Documented **`window.__myScriptCleanup`** for DonkeyCODE disable / re-inject; template and repo scripts assign teardown (observers, listeners, injected nodes).
- Documented **`GM_xmlhttpRequest` checklist** (optional host permission, `@connect`, GitHub PAT, **`data` + `Content-Type`** for GitHub REST). Wall of Fame scrapped Git publish (v2.0.0).
