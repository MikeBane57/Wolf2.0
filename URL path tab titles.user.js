// ==UserScript==
// @name         URL path tab titles
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  Rename the browser tab from URL path via JSON rules in prefs (emojis OK)
// @match        https://opssuitemain.swacorp.com/*
// @donkeycode-pref {"pathTabTitleRules":{"type":"string","group":"Rules","label":"Path rules (JSON)","description":"JSON array: [{\"pathPrefix\":\"/widgets/worksheet\",\"title\":\"📋 Worksheet\"}]. Longest matching prefix wins. Titles may include emojis. Placeholders in title: {pathname}, {search}, {hash}, {host}. Example: [{\"pathPrefix\":\"/schedule\",\"title\":\"📅 Schedule\"}]","default":"[]"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/URL%20path%20tab%20titles.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/URL%20path%20tab%20titles.user.js
// ==/UserScript==

(function() {
    'use strict';

    var baseTitleAtInject = document.title;
    var titleElObserver = null;
    var bodyMo = null;
    var navInterval = null;
    var lastNavKey = '';
    var onPopState = null;
    var onHashChange = null;

    function getPref(key, def) {
        if (typeof donkeycodeGetPref !== 'function') {
            return def;
        }
        var v = donkeycodeGetPref(key);
        if (v === undefined || v === null) {
            return def;
        }
        return v;
    }

    function parseRules() {
        var raw = getPref('pathTabTitleRules', '[]');
        if (typeof raw !== 'string') {
            raw = JSON.stringify(raw);
        }
        var s = String(raw).trim();
        if (!s) {
            return [];
        }
        try {
            var arr = JSON.parse(s);
            if (!Array.isArray(arr)) {
                return [];
            }
            return arr.filter(function(r) {
                return r && typeof r.pathPrefix === 'string' && typeof r.title === 'string';
            });
        } catch (e) {
            return [];
        }
    }

    function normalizePrefix(p) {
        var s = String(p || '').trim();
        if (!s.length) {
            return '/';
        }
        if (s[0] !== '/') {
            s = '/' + s;
        }
        if (s.length > 1 && s[s.length - 1] === '/') {
            s = s.slice(0, -1);
        }
        return s;
    }

    function pathMatches(pathname, prefixNorm) {
        if (prefixNorm === '/') {
            return true;
        }
        return pathname === prefixNorm || pathname.indexOf(prefixNorm + '/') === 0;
    }

    function pickRule(pathname, rules) {
        var candidates = [];
        var i;
        for (i = 0; i < rules.length; i++) {
            var r = rules[i];
            var pn = normalizePrefix(r.pathPrefix);
            if (pathMatches(pathname, pn)) {
                candidates.push({ rule: r, prefixLen: pn.length });
            }
        }
        if (!candidates.length) {
            return null;
        }
        candidates.sort(function(a, b) {
            return b.prefixLen - a.prefixLen;
        });
        return candidates[0].rule;
    }

    function applyPlaceholders(titleTpl) {
        var t = String(titleTpl);
        var loc = window.location;
        return t
            .split('{pathname}').join(loc.pathname || '')
            .split('{search}').join(loc.search || '')
            .split('{hash}').join(loc.hash || '')
            .split('{host}').join(loc.host || '');
    }

    function titleForCurrentUrl() {
        var rules = parseRules();
        if (!rules.length) {
            return null;
        }
        var picked = pickRule(window.location.pathname || '/', rules);
        if (!picked) {
            return null;
        }
        var out = applyPlaceholders(picked.title);
        return out.replace(/\s+/g, ' ').trim() || null;
    }

    function applyTitle() {
        var next = titleForCurrentUrl();
        if (next === null) {
            return;
        }
        if (document.title !== next) {
            document.title = next;
        }
    }

    function wireTitleElement() {
        var el = document.querySelector('title');
        if (!el || el.dataset.pathTabTitlesWired) {
            return;
        }
        el.dataset.pathTabTitlesWired = '1';
        titleElObserver = new MutationObserver(function() {
            requestAnimationFrame(function() {
                applyTitle();
            });
        });
        titleElObserver.observe(el, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function navKey() {
        return (window.location.pathname || '') + (window.location.search || '') + (window.location.hash || '');
    }

    function onNavMaybe() {
        var k = navKey();
        if (k !== lastNavKey) {
            lastNavKey = k;
            applyTitle();
        }
    }

    bodyMo = new MutationObserver(function() {
        wireTitleElement();
        applyTitle();
    });
    var obsRoot = document.head || document.documentElement;
    bodyMo.observe(obsRoot, { childList: true, subtree: true });

    wireTitleElement();
    lastNavKey = navKey();
    applyTitle();

    onPopState = function() {
        onNavMaybe();
    };
    onHashChange = function() {
        onNavMaybe();
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);

    navInterval = window.setInterval(onNavMaybe, 2000);

    window.__myScriptCleanup = function() {
        if (navInterval !== null) {
            clearInterval(navInterval);
            navInterval = null;
        }
        if (onPopState) {
            window.removeEventListener('popstate', onPopState);
            onPopState = null;
        }
        if (onHashChange) {
            window.removeEventListener('hashchange', onHashChange);
            onHashChange = null;
        }
        if (bodyMo) {
            bodyMo.disconnect();
            bodyMo = null;
        }
        if (titleElObserver) {
            titleElObserver.disconnect();
            titleElObserver = null;
        }
        var t = document.querySelector('title');
        if (t) {
            delete t.dataset.pathTabTitlesWired;
        }
        document.title = baseTitleAtInject;
        window.__myScriptCleanup = undefined;
    };
})();
