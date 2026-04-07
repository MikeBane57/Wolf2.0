// ==UserScript==
// @name         Schedule Station Tab Title
// @namespace    Wolf 2.0
// @version      1.0
// @description  Reflect schedule station dropdown (3-letter code) in the browser tab title
// @match        https://opssuitemain.swacorp.com/schedule*
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Schedule%20Station%20Tab%20Title.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Schedule%20Station%20Tab%20Title.user.js
// ==/UserScript==

(function() {
    'use strict';

    const COMBO = 'div[name="station"][role="combobox"]';
    const DIVIDER_TEXT = '.divider.text';
    const CODE_RE = /^[A-Z]{3}$/;
    const TITLE_PREFIX_RE = /^[A-Z]{3} · /;

    const bodyMo = new MutationObserver(() => {
        wireCombos();
        syncTitle();
    });

    const comboObservers = [];

    function wireCombos() {
        document.querySelectorAll(COMBO).forEach(combo => {
            if (combo.dataset.scheduleStationTabTitleWired) return;
            combo.dataset.scheduleStationTabTitleWired = '1';
            const sub = new MutationObserver(syncTitle);
            sub.observe(combo, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true
            });
            comboObservers.push(sub);
        });
    }

    function readStationCode() {
        const root = document.querySelector(COMBO);
        if (!root) return '';
        const divider = root.querySelector(DIVIDER_TEXT);
        const text = (divider && divider.textContent || '').trim().toUpperCase();
        return CODE_RE.test(text) ? text : '';
    }

    /** Strip our IATA prefix so SPA title updates still apply to the base string. */
    function baseTitle() {
        return document.title.replace(TITLE_PREFIX_RE, '');
    }

    function syncTitle() {
        const code = readStationCode();
        const base = baseTitle();
        document.title = code ? `${code} · ${base}` : base;
    }

    bodyMo.observe(document.body, { childList: true, subtree: true });
    wireCombos();
    syncTitle();

    window.__myScriptCleanup = function() {
        bodyMo.disconnect();
        comboObservers.forEach(o => o.disconnect());
        comboObservers.length = 0;
        document.title = baseTitle();
    };
})();
