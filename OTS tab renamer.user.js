// ==UserScript==
// @name         OTS tab renamer
// @namespace    Wolf 2.0
// @version      1.5
// @description  Rename /ots tabs by instance (1, 2, 3…); debounced title + registry sync; optional favicon
// @match        https://opssuitemain.swacorp.com/ots*
// @grant        none
// @donkeycode-pref {"otsTabTitleTemplate":{"type":"string","group":"Tab title","label":"Title template","description":"{n} = instance by open order (duplicate tabs get distinct numbers). {base} updates when the app changes the page title.","default":"OTS {n} · {base}","placeholder":"OTS {n} · {base}"},"otsTabFavicon":{"type":"string","group":"Tab icon","label":"Tab icon (emoji or URL)","description":"Emoji or URL. Mirrored in localStorage when set (donkeycode.mirror.otsTabFavicon).","default":"","placeholder":"📊"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/OTS%20tab%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/OTS%20tab%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    var REGISTRY_KEY = 'dc_ots_tab_registry_v1';

    var TAB_HANDOFF_KEY = 'dc_ots_tab_id_handoff';
    var tabId = null;
    try {
        var handed = sessionStorage.getItem(TAB_HANDOFF_KEY);
        if (handed) {
            sessionStorage.removeItem(TAB_HANDOFF_KEY);
            tabId = handed;
        } else {
            tabId = 'o-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
        }
    } catch (e) {
        tabId = 'o-fallback';
    }

    function persistTabIdForRefresh() {
        try {
            sessionStorage.setItem(TAB_HANDOFF_KEY, tabId);
        } catch (e) {}
    }

    var joinedAt = Date.now();
    var baseTitleAtInject = document.title;
    var lastTitleSetByUs = '';
    var faviconLinkEl = null;
    var rawTitleStorageKey = 'dc_ots_raw_title_' + location.pathname + location.search;
    var titleMo = null;
    var titleDebounce = null;
    var onStorageBound = null;

    var FAVICON_MIRROR_KEY = 'donkeycode.mirror.otsTabFavicon';

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

    function getFaviconPref() {
        var raw = typeof donkeycodeGetPref === 'function' ? donkeycodeGetPref('otsTabFavicon') : '';
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

    function applyOnce(instanceN, rawBaseOverride) {
        var n = String(instanceN);
        var tpl = String(getPref('otsTabTitleTemplate', 'OTS {n} · {base}') || 'OTS {n} · {base}');
        var rawBase = rawBaseOverride !== undefined ? rawBaseOverride : baseTitleAtInject;
        writeStoredRawTitle(rawBase);
        var next = buildTitleFromParts(tpl, n, rawBase);
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
            faviconLinkEl.id = 'dc-ots-tab-favicon';
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
            var inst = registerAndGetInstance();
            applyOnce(inst);
        }, 200);
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
        window.addEventListener('beforeunload', persistTabIdForRefresh);
        window.addEventListener('pagehide', persistTabIdForRefresh);

        var titleEl = document.querySelector('title');
        if (titleEl) {
            titleMo = new MutationObserver(function() {
                scheduleReapply();
            });
            titleMo.observe(titleEl, { childList: true, subtree: true, characterData: true });
        }

        onStorageBound = function(ev) {
            if (ev.key === REGISTRY_KEY) {
                scheduleReapply();
            }
        };
        window.addEventListener('storage', onStorageBound);
    }

    init();

    window.__myScriptCleanup = function() {
        removeFromRegistry();
        window.removeEventListener('beforeunload', removeFromRegistry);
        window.removeEventListener('pagehide', removeFromRegistry);
        window.removeEventListener('beforeunload', persistTabIdForRefresh);
        window.removeEventListener('pagehide', persistTabIdForRefresh);
        if (onStorageBound) {
            window.removeEventListener('storage', onStorageBound);
            onStorageBound = null;
        }
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
        try {
            sessionStorage.removeItem(TAB_HANDOFF_KEY);
        } catch (e) {}
        document.title = readStoredRawTitle() || baseTitleAtInject;
    };
})();
