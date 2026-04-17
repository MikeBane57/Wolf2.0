// ==UserScript==
// @name         Dynamic station tab renamer
// @namespace    Wolf 2.0
// @version      2.4
// @description  Reflect schedule station (3-letter code) in the tab title; template in prefs; optional tab icon
// @match        https://opssuitemain.swacorp.com/schedule*
// @donkeycode-pref {"stationTabTitleTemplate":{"type":"string","group":"Tab title","label":"Title template","description":"Use {station} and optionally {base}. Omit {base} for station-only titles, e.g. {station} only.","default":"{station} · {base}"},"stationTabFaviconUrl":{"type":"string","group":"Tab icon","label":"Tab icon (emoji or URL)","description":"Paste one emoji (e.g. 📅) or a full image URL (https://… or data:…). Leave empty for the default site icon.","default":"","placeholder":"📅 or https://…"}}
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
        return String(getPref('stationTabTitleTemplate', '{station} · {base}') || '{station} · {base}');
    }

    var bodyRefreshTimer = null;
    var titlePollTimer = null;
    var TITLE_POLL_MS = 3000;

    function scheduleBodyRefresh() {
        if (bodyRefreshTimer) {
            clearTimeout(bodyRefreshTimer);
        }
        bodyRefreshTimer = setTimeout(function() {
            bodyRefreshTimer = null;
            wireCombos();
            syncTitle();
            applyFavicon();
        }, 120);
    }

    const bodyMo = new MutationObserver(function() {
        scheduleBodyRefresh();
    });

    const comboObservers = [];
    var faviconLinkEl = null;

    function escapeXml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function resolveTabIconHref(raw) {
        var s = String(raw || '').trim();
        if (!s) {
            return '';
        }
        if (/^https?:\/\//i.test(s) || /^data:/i.test(s) || (s.charAt(0) === '/' && s.length > 1)) {
            return s;
        }
        var graphemes = Array.from(s).slice(0, 4);
        var label = graphemes.join('');
        var svg =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
            '<text x="32" y="44" text-anchor="middle" font-size="40" ' +
            'font-family="system-ui,Segoe UI Emoji,Apple Color Emoji,Noto Color Emoji,sans-serif">' +
            escapeXml(label) +
            '</text></svg>';
        return 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    function applyFavicon() {
        var href = resolveTabIconHref(getPref('stationTabFaviconUrl', ''));
        if (!href) {
            if (faviconLinkEl && faviconLinkEl.parentNode) {
                faviconLinkEl.parentNode.removeChild(faviconLinkEl);
            }
            faviconLinkEl = null;
            return;
        }
        if (!faviconLinkEl) {
            faviconLinkEl = document.createElement('link');
            faviconLinkEl.id = 'donkeycode-station-tab-favicon';
            faviconLinkEl.rel = 'icon';
            document.head.appendChild(faviconLinkEl);
        }
        if (faviconLinkEl.getAttribute('href') !== href) {
            faviconLinkEl.setAttribute('href', href);
        }
    }

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
            if (document.title !== base) {
                document.title = base;
            }
            return;
        }
        var next = applyTitle(code, base);
        if (document.title !== next) {
            document.title = next;
        }
    }

    bodyMo.observe(document.body, { childList: true, subtree: true });
    wireCombos();
    syncTitle();
    applyFavicon();
    titlePollTimer = setInterval(function() {
        syncTitle();
        applyFavicon();
    }, TITLE_POLL_MS);

    window.__myScriptCleanup = function() {
        if (bodyRefreshTimer) {
            clearTimeout(bodyRefreshTimer);
            bodyRefreshTimer = null;
        }
        if (titlePollTimer) {
            clearInterval(titlePollTimer);
            titlePollTimer = null;
        }
        bodyMo.disconnect();
        comboObservers.forEach(function(o) {
            o.disconnect();
        });
        comboObservers.length = 0;
        document.querySelectorAll(COMBO + '[data-dynamic-station-tab-renamer-wired]').forEach(function(el) {
            delete el.dataset.dynamicStationTabRenamerWired;
        });
        document.title = baseTitle();
        if (faviconLinkEl && faviconLinkEl.parentNode) {
            faviconLinkEl.parentNode.removeChild(faviconLinkEl);
        }
        faviconLinkEl = null;
    };
})();
