# Wolf 2.0 userscript standardization (plan)

This document captures how we will standardize Tampermonkey-style scripts for DonkeyCODE and the ops suite. **Fill in the “DonkeyCODE” section** when the other agent returns answers from the DonkeyCODE codebase.

## Goals

- One `.user.js` file per feature (users can enable/disable individually).
- Consistent headers and structure so scripts are easy to review and maintain.
- Default scope: `https://opssuitemain.swacorp.com/*`; use a **narrower** `@match` when a script only applies to one app area (e.g. operational dashboard).

## Header conventions (current repo practice)

| Item | Convention |
|------|------------|
| Opening/closing | `// ==UserScript==` and `// ==/UserScript==` (space after `//`) |
| First line of file | No leading blank line before the opening tag |
| `@namespace` | `Wolf 2.0` |
| `@updateURL` / `@downloadURL` | Raw **Wolf2.0** GitHub URLs; filename path segment URL-encoded (spaces → `%20`, etc.)—**if** DonkeyCODE uses these tags (see below) |
| Body | IIFE: `(function() { 'use strict'; ... })();` |
| Dynamic UI | Prefer `MutationObserver` on `document.body` when the app adds nodes after load |

## Template

Copy `templates/userscript.template.user.js` when starting a new script; rename the file to match the `@name` and update `@updateURL` / `@downloadURL` paths to the real filename.

## DonkeyCODE (pending confirmation)

Paste answers from the DonkeyCODE investigation here so we can lock rules and update the template.

- **Metadata used:** (which of `@match`, `@grant`, `@connect`, `@updateURL`, `@downloadURL`, … are honored?)
- **Grants / APIs:** (which `GM_*` are available?)
- **Cross-origin:** (`GM_xmlhttpRequest` + `@connect` vs `fetch`, etc.)
- **Updates:** (manual only vs `@updateURL`?)
- **Storage:** (`GM_getValue` / `GM_setValue` vs `localStorage`?)
- **Other constraints:** (forbidden patterns, size limits, …)

## Changelog

- Initial plan and `templates/userscript.template.user.js` added; `Ops Dashboard Power Controls.user.js` header aligned to `// ==UserScript==`; `Flight Leg Opacity Adjuster.user.js` leading blank line removed.
