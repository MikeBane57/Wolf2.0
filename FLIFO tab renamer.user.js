// ==UserScript==
// @name         FLIFO tab renamer
// @namespace    Wolf 2.0
// @version      1.0
// @description  Rename FLIFO tabs once per load; {base} = title when the page loaded; optional favicon
// @match        https://opssuitemain.swacorp.com/flifo*
// @grant        none
// @donkeycode-pref {"flifoTabTitleTemplate":{"type":"string","group":"Tab title","label":"Title template","description":"{base} = browser title when the tab loaded. Reload to refresh. Extra path after /flifo is ignored for matching.","default":"FLIFO · {base}","placeholder":"FLIFO · {base}"},"flifoTabFavicon":{"type":"string","group":"Tab icon","label":"Tab icon (emoji or URL)","description":"Emoji or https://… URL. Empty = site default.","default":"","placeholder":"🛫"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/FLIFO%20tab%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/FLIFO%20tab%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    var baseTitleAtInject = document.title;
    var faviconLinkEl = null;
    var rawTitleKey = 'dc_flifo_tab_raw_' + location.pathname + location.search;

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
        var tpl = String(getPref('flifoTabTitleTemplate', 'FLIFO · {base}') || 'FLIFO · {base}');
        if (tpl.indexOf('{base}') === -1) {
            tpl = tpl + '{base}';
        }
        var rawBase = baseTitleAtInject;
        writeStoredRaw(rawBase);
        var next = tpl.split('{base}').join(rawBase).replace(/\s+/g, ' ').trim();
        if (next) {
            document.title = next;
        }

        var href = resolveTabIconHref(getPref('flifoTabFavicon', ''));
        if (!href) {
            return;
        }
        faviconLinkEl = document.createElement('link');
        faviconLinkEl.id = 'dc-flifo-tab-favicon';
        faviconLinkEl.rel = 'icon';
        faviconLinkEl.setAttribute('href', href);
        (document.head || document.documentElement).appendChild(faviconLinkEl);
    }

    applyOnce();

    window.__myScriptCleanup = function() {
        if (faviconLinkEl && faviconLinkEl.parentNode) {
            faviconLinkEl.parentNode.removeChild(faviconLinkEl);
        }
        faviconLinkEl = null;
        document.title = readStoredRaw() || baseTitleAtInject;
    };
})();
