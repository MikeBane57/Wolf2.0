// ==UserScript==
// @name         OTS tab renamer
// @namespace    Wolf 2.0
// @version      1.3
// @description  Rename /ots tabs by instance (1, 2, 3…) once per page load; optional favicon; full reload re-runs
// @match        https://opssuitemain.swacorp.com/ots*
// @grant        none
// @donkeycode-pref {"otsTabTitleTemplate":{"type":"string","group":"Tab title","label":"Title template","description":"{n} = tab instance (1, 2, 3…) by open order. {base} = title when the page loaded. Refresh the tab to pick up app title changes.","default":"OTS {n} · {base}","placeholder":"OTS {n} · {base}"},"otsTabFavicon":{"type":"string","group":"Tab icon","label":"Tab icon (emoji or URL)","description":"Emoji or https://… image URL. Empty = keep site icon.","default":"","placeholder":"📊"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/OTS%20tab%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/OTS%20tab%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    var REGISTRY_KEY = 'dc_ots_tab_registry_v1';

    var tabId = null;
    try {
        tabId = sessionStorage.getItem('dc_ots_tab_id');
        if (!tabId) {
            tabId = 'o-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
            sessionStorage.setItem('dc_ots_tab_id', tabId);
        }
    } catch (e) {
        tabId = 'o-fallback';
    }

    var joinedAt = Date.now();
    var baseTitleAtInject = document.title;
    var faviconLinkEl = null;
    var rawTitleStorageKey = 'dc_ots_raw_title_' + location.pathname + location.search;

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

    function readRegistry() {
        try {
            var raw = localStorage.getItem(REGISTRY_KEY);
            if (!raw) {
                return [];
            }
            var a = JSON.parse(raw);
            return Array.isArray(a) ? a : [];
        } catch (e) {
            return [];
        }
    }

    function writeRegistry(arr) {
        try {
            localStorage.setItem(REGISTRY_KEY, JSON.stringify(arr));
        } catch (e) {}
    }

    function registerAndGetInstance() {
        var list = readRegistry();
        var found = false;
        var i;
        for (i = 0; i < list.length; i++) {
            if (list[i] && list[i].id === tabId) {
                found = true;
                break;
            }
        }
        if (!found) {
            list.push({ id: tabId, joinedAt: joinedAt });
            writeRegistry(list);
        }
        list.sort(function(a, b) {
            return (a.joinedAt || 0) - (b.joinedAt || 0);
        });
        var idx = -1;
        for (i = 0; i < list.length; i++) {
            if (list[i].id === tabId) {
                idx = i;
                break;
            }
        }
        return idx >= 0 ? idx + 1 : 1;
    }

    function readStoredRawTitle() {
        try {
            return sessionStorage.getItem(rawTitleStorageKey) || '';
        } catch (e) {
            return '';
        }
    }

    function writeStoredRawTitle(t) {
        try {
            sessionStorage.setItem(rawTitleStorageKey, t);
        } catch (e) {}
    }

    function buildTitleFromParts(tpl, n, rawBase) {
        return String(tpl)
            .split('{n}').join(String(n))
            .split('{base}').join(rawBase || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function applyOnce(instanceN) {
        var n = String(instanceN);
        var tpl = String(getPref('otsTabTitleTemplate', 'OTS {n} · {base}') || 'OTS {n} · {base}');
        var rawBase = baseTitleAtInject;
        writeStoredRawTitle(rawBase);
        var next = buildTitleFromParts(tpl, n, rawBase);
        if (next) {
            document.title = next;
        }

        var href = resolveTabIconHref(getPref('otsTabFavicon', ''));
        if (!href) {
            return;
        }
        if (!faviconLinkEl) {
            faviconLinkEl = document.createElement('link');
            faviconLinkEl.id = 'dc-ots-tab-favicon';
            faviconLinkEl.rel = 'icon';
            (document.head || document.documentElement).appendChild(faviconLinkEl);
        }
        faviconLinkEl.setAttribute('href', href);
    }

    function removeFromRegistry() {
        var list = readRegistry().filter(function(e) {
            return e && e.id !== tabId;
        });
        writeRegistry(list);
    }

    function init() {
        var instanceN = registerAndGetInstance();
        applyOnce(instanceN);
        window.addEventListener('beforeunload', removeFromRegistry);
        window.addEventListener('pagehide', removeFromRegistry);
    }

    init();

    window.__myScriptCleanup = function() {
        removeFromRegistry();
        window.removeEventListener('beforeunload', removeFromRegistry);
        window.removeEventListener('pagehide', removeFromRegistry);
        if (faviconLinkEl && faviconLinkEl.parentNode) {
            faviconLinkEl.parentNode.removeChild(faviconLinkEl);
        }
        faviconLinkEl = null;
        document.title = readStoredRawTitle() || baseTitleAtInject;
    };
})();
