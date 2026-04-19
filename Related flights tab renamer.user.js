// ==UserScript==
// @name         Related flights tab renamer
// @namespace    Wolf 2.0
// @version      1.3
// @description  Rename related-flights tabs; debounced title watch; {base} from app title; optional favicon
// @match        https://opssuitemain.swacorp.com/widgets/related-flights*
// @grant        none
// @donkeycode-pref {"relatedFlightsTabTitleTemplate":{"type":"string","group":"Tab title","label":"Title template","description":"Include {base} only if you want the original page title in the tab. Plain text uses only your text. Reload to refresh {base}.","default":"Related flights · {base}","placeholder":"Related flights · {base}"},"relatedFlightsTabFavicon":{"type":"string","group":"Tab icon","label":"Tab icon (emoji or URL)","description":"Emoji or https://… URL. Empty = site default. Mirrored in localStorage (donkeycode.mirror.relatedFlightsTabFavicon) when set so cloud sync cannot drop it.","default":"","placeholder":"🔗"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Related%20flights%20tab%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Related%20flights%20tab%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    var baseTitleAtInject = document.title;
    var lastTitleSetByUs = '';
    var faviconLinkEl = null;
    var rawTitleKey = 'dc_related_flights_tab_raw_' + location.pathname + location.search;
    var titleMo = null;
    var titleDebounce = null;

    var FAVICON_MIRROR_KEY = 'donkeycode.mirror.relatedFlightsTabFavicon';

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

    /** DonkeyCODE prefs + localStorage mirror so emoji/URL survives empty cloud merge. */
    function getFaviconPref() {
        var raw = typeof donkeycodeGetPref === 'function' ? donkeycodeGetPref('relatedFlightsTabFavicon') : '';
        var ext = raw !== undefined && raw !== null ? String(raw).trim() : '';
        try {
            if (ext) {
                localStorage.setItem(FAVICON_MIRROR_KEY, ext);
                return ext;
            }
            var mir = localStorage.getItem(FAVICON_MIRROR_KEY);
            return mir ? String(mir).trim() : '';
        } catch (e) {
            return ext;
        }
    }

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

    function readStoredRaw() {
        try {
            return sessionStorage.getItem(rawTitleKey) || '';
        } catch (e) {
            return '';
        }
    }

    function writeStoredRaw(t) {
        try {
            sessionStorage.setItem(rawTitleKey, t);
        } catch (e) {}
    }

    function applyOnce() {
        var tpl = String(getPref('relatedFlightsTabTitleTemplate', 'Related flights · {base}') || 'Related flights · {base}');
        var rawBase = baseTitleAtInject;
        writeStoredRaw(rawBase);
        var next = tpl.split('{base}').join(rawBase).replace(/\s+/g, ' ').trim();
        if (next) {
            lastTitleSetByUs = next;
            document.title = next;
        }

        var href = resolveTabIconHref(getFaviconPref());
        if (!href) {
            if (faviconLinkEl && faviconLinkEl.parentNode) {
                faviconLinkEl.parentNode.removeChild(faviconLinkEl);
            }
            faviconLinkEl = null;
            return;
        }
        if (!faviconLinkEl) {
            faviconLinkEl = document.createElement('link');
            faviconLinkEl.id = 'dc-related-flights-tab-favicon';
            faviconLinkEl.rel = 'icon';
            (document.head || document.documentElement).appendChild(faviconLinkEl);
        }
        faviconLinkEl.setAttribute('href', href);
    }

    function scheduleReapply() {
        if (titleDebounce) {
            clearTimeout(titleDebounce);
        }
        titleDebounce = setTimeout(function() {
            titleDebounce = null;
            var cur = document.title;
            if (cur && cur !== lastTitleSetByUs) {
                baseTitleAtInject = cur;
            }
            applyOnce();
        }, 200);
    }

    applyOnce();

    var titleEl = document.querySelector('title');
    if (titleEl) {
        titleMo = new MutationObserver(function() {
            scheduleReapply();
        });
        titleMo.observe(titleEl, { childList: true, subtree: true, characterData: true });
    }

    window.__myScriptCleanup = function() {
        if (titleMo) {
            titleMo.disconnect();
            titleMo = null;
        }
        if (titleDebounce) {
            clearTimeout(titleDebounce);
            titleDebounce = null;
        }
        if (faviconLinkEl && faviconLinkEl.parentNode) {
            faviconLinkEl.parentNode.removeChild(faviconLinkEl);
        }
        faviconLinkEl = null;
        document.title = readStoredRaw() || baseTitleAtInject;
    };
})();
