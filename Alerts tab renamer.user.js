// ==UserScript==
// @name         Alerts tab renamer
// @namespace    Wolf 2.0
// @version      1.2
// @description  Rename /alerts tabs by instance (1, 2, 3…) with optional favicon; prefs in DonkeyCODE
// @match        https://opssuitemain.swacorp.com/alerts*
// @grant        none
// @donkeycode-pref {"alertsTabTitleTemplate":{"type":"string","group":"Tab title","label":"Title template","description":"{n} = this tab’s instance number (1, 2, 3…). {base} = the page title before renaming.","default":"Alerts {n} · {base}","placeholder":"Alerts {n} · {base}"},"alertsTabFavicon":{"type":"string","group":"Tab icon","label":"Tab icon (emoji or URL)","description":"Emoji or https://… image URL. Empty = keep site icon.","default":"","placeholder":"🔔"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Alerts%20tab%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Alerts%20tab%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    var REGISTRY_KEY = 'dc_alerts_tab_registry_v1';
    var HEARTBEAT_MS = 2000;
    var STALE_MS = 6000;

    var tabId = null;
    try {
        tabId = sessionStorage.getItem('dc_alerts_tab_id');
        if (!tabId) {
            tabId = 'a-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
            sessionStorage.setItem('dc_alerts_tab_id', tabId);
        }
    } catch (e) {
        tabId = 'a-fallback';
    }

    var joinedAt = Date.now();
    var baseTitleAtInject = document.title;
    var faviconLinkEl = null;
    var heartbeatTimer = null;
    var cachedInstanceN = 1;
    var rawTitleStorageKey = 'dc_alerts_raw_title_' + location.pathname + location.search;

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

    function pruneAndUpsert() {
        var now = Date.now();
        var list = readRegistry();
        list = list.filter(function(entry) {
            return entry && now - (entry.lastSeen || 0) < STALE_MS;
        });
        var found = false;
        var i;
        for (i = 0; i < list.length; i++) {
            if (list[i].id === tabId) {
                list[i].lastSeen = now;
                if (!list[i].joinedAt) {
                    list[i].joinedAt = joinedAt;
                }
                found = true;
                break;
            }
        }
        if (!found) {
            list.push({ id: tabId, joinedAt: joinedAt, lastSeen: now });
        }
        writeRegistry(list);
        return list;
    }

    function computeInstanceFromList(list) {
        list.sort(function(a, b) {
            return (a.joinedAt || 0) - (b.joinedAt || 0);
        });
        var idx = -1;
        var j;
        for (j = 0; j < list.length; j++) {
            if (list[j].id === tabId) {
                idx = j;
                break;
            }
        }
        return idx >= 0 ? idx + 1 : 1;
    }

    function getInstanceNumber() {
        return cachedInstanceN;
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

    function applyTitle() {
        var n = String(getInstanceNumber());
        var tpl = String(getPref('alertsTabTitleTemplate', 'Alerts {n} · {base}') || 'Alerts {n} · {base}');
        var rawBase = readStoredRawTitle() || baseTitleAtInject || document.title;
        if (!readStoredRawTitle()) {
            writeStoredRawTitle(rawBase);
        }
        rawBase = readStoredRawTitle() || rawBase;
        var built = buildTitleFromParts(tpl, n, rawBase);
        if (document.title !== built) {
            rawBase = document.title;
            writeStoredRawTitle(rawBase);
        }
        var next = buildTitleFromParts(tpl, n, rawBase);
        if (next && next !== document.title) {
            document.title = next;
        }
    }

    function applyFavicon() {
        var href = resolveTabIconHref(getPref('alertsTabFavicon', ''));
        if (!href) {
            if (faviconLinkEl && faviconLinkEl.parentNode) {
                faviconLinkEl.parentNode.removeChild(faviconLinkEl);
            }
            faviconLinkEl = null;
            return;
        }
        if (!faviconLinkEl) {
            faviconLinkEl = document.createElement('link');
            faviconLinkEl.id = 'dc-alerts-tab-favicon';
            faviconLinkEl.rel = 'icon';
            (document.head || document.documentElement).appendChild(faviconLinkEl);
        }
        if (faviconLinkEl.getAttribute('href') !== href) {
            faviconLinkEl.setAttribute('href', href);
        }
    }

    function applyVisuals() {
        applyTitle();
        applyFavicon();
    }

    function heartbeat() {
        var list = pruneAndUpsert();
        cachedInstanceN = computeInstanceFromList(list);
        applyVisuals();
    }

    function removeFromRegistry() {
        var list = readRegistry().filter(function(e) {
            return e && e.id !== tabId;
        });
        writeRegistry(list);
    }

    function init() {
        if (!readStoredRawTitle()) {
            writeStoredRawTitle(baseTitleAtInject);
        }
        heartbeat();
        heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
        window.addEventListener('beforeunload', removeFromRegistry);
        window.addEventListener('pagehide', removeFromRegistry);
    }

    init();

    window.__myScriptCleanup = function() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
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
