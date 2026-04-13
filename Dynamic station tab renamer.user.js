// ==UserScript==
// @name         Dynamic station tab renamer
// @namespace    Wolf 2.0
// @version      2.0
// @description  Reflect schedule station (3-letter code) in the tab title; template in prefs
// @match        https://opssuitemain.swacorp.com/schedule*
// @donkeycode-pref {"stationTabTitleTemplate":{"type":"string","group":"Tab title","label":"Title template","description":"Use {station} for the IATA code and {base} for the page title without this prefix. Example: {station} · {base}","default":"{station} · {base}"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Dynamic%20station%20tab%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Dynamic%20station%20tab%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    const COMBO = 'div[name="station"][role="combobox"]';
    const CODE_RE = /^[A-Z]{3}$/;
    const TITLE_PREFIX_RE = /^[A-Z]{3} · /;
    const IGNORE_CODES = new Set(['ABC']);

    function getPref(key, def) {
        if (typeof donkeycodeGetPref !== 'function') {
            return def;
        }
        var v = donkeycodeGetPref(key);
        if (v === undefined || v === null || v === '') {
            return def;
        }
        return v;
    }

    function getTemplate() {
        var t = String(getPref('stationTabTitleTemplate', '{station} · {base}') || '{station} · {base}');
        if (t.indexOf('{base}') === -1) {
            t = t + '{base}';
        }
        return t;
    }

    const bodyMo = new MutationObserver(function() {
        wireCombos();
        wireTitleElement();
        syncTitle();
    });

    const comboObservers = [];
    let titleElObserver = null;

    function wireCombos() {
        document.querySelectorAll(COMBO).forEach(function(combo) {
            if (combo.dataset.dynamicStationTabRenamerWired) {
                return;
            }
            combo.dataset.dynamicStationTabRenamerWired = '1';
            const sub = new MutationObserver(function() {
                syncTitle();
            });
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

    function pickCodeFromCombo(root) {
        const divider = root.querySelector('.divider.text, .text.divider');
        if (divider) {
            const t = divider.textContent.replace(/\s+/g, ' ').trim().toUpperCase();
            if (CODE_RE.test(t)) {
                return t;
            }
        }

        const selected = root.querySelector(
            '[role="option"][aria-selected="true"] .text, ' +
            '[role="option"][aria-checked="true"] .text, ' +
            '.item.active.selected .text, ' +
            '.item.selected.active .text'
        );
        if (selected) {
            const t = selected.textContent.replace(/\s+/g, ' ').trim().toUpperCase();
            if (CODE_RE.test(t)) {
                return t;
            }
        }

        return '';
    }

    function readStationCode() {
        const roots = document.querySelectorAll(COMBO);
        if (roots.length === 0) {
            return '';
        }

        for (let i = roots.length - 1; i >= 0; i--) {
            const c = pickCodeFromCombo(roots[i]);
            if (c) {
                return c;
            }
        }
        return '';
    }

    function extractBaseFromTitle(rawTitle, code) {
        if (!shouldPrefixTitle(code)) {
            return rawTitle.replace(TITLE_PREFIX_RE, '');
        }
        var tpl = getTemplate();
        var withStation = tpl.split('{station}').join(code);
        var idx = withStation.indexOf('{base}');
        if (idx === -1) {
            return rawTitle.replace(TITLE_PREFIX_RE, '');
        }
        var pre = withStation.slice(0, idx);
        var post = withStation.slice(idx + 6);
        if (rawTitle.length >= pre.length + post.length &&
            rawTitle.indexOf(pre) === 0 &&
            rawTitle.lastIndexOf(post) === rawTitle.length - post.length) {
            return rawTitle.slice(pre.length, rawTitle.length - post.length);
        }
        return rawTitle.replace(TITLE_PREFIX_RE, '');
    }

    function baseTitle() {
        return extractBaseFromTitle(document.title, readStationCode());
    }

    function shouldPrefixTitle(code) {
        return Boolean(code) && !IGNORE_CODES.has(code);
    }

    function applyTitle(code, base) {
        var tpl = getTemplate();
        return tpl.split('{station}').join(code).split('{base}').join(base);
    }

    function syncTitle() {
        var code = readStationCode();
        var base = baseTitle();
        if (!shouldPrefixTitle(code)) {
            document.title = base;
            return;
        }
        document.title = applyTitle(code, base);
    }

    function ensurePrefixedTitle() {
        var code = readStationCode();
        var base = baseTitle();
        if (!shouldPrefixTitle(code)) {
            if (TITLE_PREFIX_RE.test(document.title)) {
                document.title = base;
            }
            return;
        }
        var next = applyTitle(code, base);
        if (document.title !== next) {
            document.title = next;
        }
    }

    function wireTitleElement() {
        const el = document.querySelector('title');
        if (!el || el.dataset.dynamicStationTabRenamerTitle) {
            return;
        }
        el.dataset.dynamicStationTabRenamerTitle = '1';
        titleElObserver = new MutationObserver(function() {
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
        comboObservers.forEach(function(o) {
            o.disconnect();
        });
        comboObservers.length = 0;
        if (titleElObserver) {
            titleElObserver.disconnect();
            titleElObserver = null;
        }
        document.querySelectorAll(COMBO + '[data-dynamic-station-tab-renamer-wired]').forEach(function(el) {
            delete el.dataset.dynamicStationTabRenamerWired;
        });
        var te = document.querySelector('title');
        if (te) {
            delete te.dataset.dynamicStationTabRenamerTitle;
        }
        document.title = baseTitle();
    };
})();
