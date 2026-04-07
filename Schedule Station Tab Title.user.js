// ==UserScript==
// @name         Schedule Station Tab Title
// @namespace    Wolf 2.0
// @version      1.1
// @description  Reflect schedule station dropdown (3-letter code) in the browser tab title
// @match        https://opssuitemain.swacorp.com/schedule*
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Schedule%20Station%20Tab%20Title.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Schedule%20Station%20Tab%20Title.user.js
// ==/UserScript==

(function() {
    'use strict';

    const COMBO = 'div[name="station"][role="combobox"]';
    const CODE_RE = /^[A-Z]{3}$/;
    const TITLE_PREFIX_RE = /^[A-Z]{3} · /;

    const bodyMo = new MutationObserver(() => {
        wireCombos();
        wireTitleElement();
        syncTitle();
    });

    const comboObservers = [];
    let titleElObserver = null;

    function wireCombos() {
        document.querySelectorAll(COMBO).forEach(combo => {
            if (combo.dataset.scheduleStationTabTitleWired) return;
            combo.dataset.scheduleStationTabTitleWired = '1';
            const sub = new MutationObserver(() => syncTitle());
            sub.observe(combo, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['aria-selected', 'aria-checked', 'class']
            });
            comboObservers.push(sub);
        });
    }

    /**
     * Semantic UI: visible selection is often .divider.text; React may instead
     * only mark the selected .item — try both.
     */
    function pickCodeFromCombo(root) {
        const divider = root.querySelector('.divider.text, .text.divider');
        if (divider) {
            const t = divider.textContent.replace(/\s+/g, ' ').trim().toUpperCase();
            if (CODE_RE.test(t)) return t;
        }

        const selected = root.querySelector(
            '[role="option"][aria-selected="true"] .text, ' +
            '[role="option"][aria-checked="true"] .text, ' +
            '.item.active.selected .text, ' +
            '.item.selected.active .text'
        );
        if (selected) {
            const t = selected.textContent.replace(/\s+/g, ' ').trim().toUpperCase();
            if (CODE_RE.test(t)) return t;
        }

        return '';
    }

    function readStationCode() {
        const roots = document.querySelectorAll(COMBO);
        if (roots.length === 0) return '';

        for (let i = roots.length - 1; i >= 0; i--) {
            const c = pickCodeFromCombo(roots[i]);
            if (c) return c;
        }
        return '';
    }

    function baseTitle() {
        return document.title.replace(TITLE_PREFIX_RE, '');
    }

    function syncTitle() {
        const code = readStationCode();
        const base = baseTitle();
        document.title = code ? `${code} · ${base}` : base;
    }

    /**
     * SPAs often reset document.title via <title> text; re-apply our prefix.
     */
    function ensurePrefixedTitle() {
        const code = readStationCode();
        if (!code) {
            if (TITLE_PREFIX_RE.test(document.title)) {
                document.title = baseTitle();
            }
            return;
        }
        const prefix = `${code} · `;
        if (!document.title.startsWith(prefix)) {
            document.title = prefix + baseTitle();
        }
    }

    function wireTitleElement() {
        const el = document.querySelector('title');
        if (!el || el.dataset.scheduleStationTabTitleTitleEl) return;
        el.dataset.scheduleStationTabTitleTitleEl = '1';
        titleElObserver = new MutationObserver(() => {
            requestAnimationFrame(ensurePrefixedTitle);
        });
        titleElObserver.observe(el, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    bodyMo.observe(document.body, { childList: true, subtree: true });
    wireCombos();
    wireTitleElement();
    syncTitle();

    window.__myScriptCleanup = function() {
        bodyMo.disconnect();
        comboObservers.forEach(o => o.disconnect());
        comboObservers.length = 0;
        if (titleElObserver) {
            titleElObserver.disconnect();
            titleElObserver = null;
        }
        document.querySelectorAll(`${COMBO}[data-schedule-station-tab-title-wired]`).forEach(el => {
            delete el.dataset.scheduleStationTabTitleWired;
        });
        const t = document.querySelector('title');
        if (t) delete t.dataset.scheduleStationTabTitleTitleEl;
        document.title = baseTitle();
    };
})();
