// ==UserScript==
// @name         TODO Short descriptive name
// @namespace    Wolf 2.0
// @version      0.1.0
// @description  TODO What this script does (one line; ignored by DonkeyCODE loader, useful for humans)
// @match        https://opssuitemain.swacorp.com/*
// Optional: @exclude https://opssuitemain.swacorp.com/some-path*
//
// DonkeyCODE only implements GM_xmlhttpRequest. Omit the next two lines if you use fetch() same-origin only.
// @grant        GM_xmlhttpRequest
// @connect      example.com
//
// Updates: DonkeyCODE re-fetches from the GitHub repo listing / settings — not from @updateURL.
// Optional for Tampermonkey or docs only:
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/TODO-EncodedName.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/TODO-EncodedName.user.js
// ==/UserScript==

(function() {
    'use strict';

    // TODO: implementation
    // Storage: use localStorage / sessionStorage on this origin (no GM_getValue in DonkeyCODE).

    // DonkeyCODE calls this when the script is toggled off or before re-inject (prefs).
    // Save listener/observer references so removeEventListener / disconnect work.
    window.__myScriptCleanup = function() {
        // TODO: disconnect MutationObservers, clear intervals, removeEventListener with same fn ref, remove injected nodes
    };
})();
