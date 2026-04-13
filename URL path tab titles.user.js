// ==UserScript==
// @name         URL path tab titles
// @namespace    Wolf 2.0
// @version      1.2.0
// @description  Rename the browser tab from URL path; URLs and titles in separate pref fields (emojis OK)
// @match        https://opssuitemain.swacorp.com/*
// @donkeycode-pref {"pathTabTitleUrls":{"type":"string","group":"Tab titles","label":"URLs or paths","description":"One per line; same order as Tab titles below. Full URL (https://…) or path like /alerts. Lines starting with # are ignored. Host must match this page.","default":"","placeholder":"https://opssuitemain.swacorp.com/alerts"},"pathTabTitleTitles":{"type":"string","group":"Tab titles","label":"Tab titles","description":"One per line: tab name for the URL on the same line (line 1 with line 1, etc.). Emojis OK. Placeholders: {pathname} {search} {hash} {host}","default":"","placeholder":"🚨 Alerts"}}
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

    function parseLeftToPathPrefix(left) {
        var s = String(left || '').trim();
        if (!s) {
            return null;
        }
        if (/^https?:\/\//i.test(s)) {
            try {
                var u = new URL(s);
                if (u.hostname !== window.location.hostname) {
                    return null;
                }
                return normalizePrefix(u.pathname);
            } catch (e) {
                return null;
            }
        }
        return normalizePrefix(s);
    }

    function splitPrefLines(text) {
        return String(text || '').split(/\r?\n/);
    }

    function parseRulesFromPairedFields() {
        var urlLines = splitPrefLines(getPref('pathTabTitleUrls', ''));
        var titleLines = splitPrefLines(getPref('pathTabTitleTitles', ''));
        var max = Math.max(urlLines.length, titleLines.length);
        var rules = [];
        var i;
        for (i = 0; i < max; i++) {
            var uRaw = (urlLines[i] !== undefined) ? urlLines[i] : '';
            var tRaw = (titleLines[i] !== undefined) ? titleLines[i] : '';
            var u = uRaw.trim();
            var t = tRaw.trim();
            if (!u || u[0] === '#') {
                continue;
            }
            if (!t || t[0] === '#') {
                continue;
            }
            var pathPrefix = parseLeftToPathPrefix(u);
            if (pathPrefix === null) {
                continue;
            }
            rules.push({ pathPrefix: pathPrefix, title: t });
        }
        return rules;
    }

    function parseRulesFromLines(text) {
        var rules = [];
        var raw = String(text || '');
        var lines = raw.split(/\r?\n/);
        var i;
        for (i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line[0] === '#') {
                continue;
            }
            var pipe = line.indexOf('|');
            if (pipe === -1) {
                continue;
            }
            var left = line.slice(0, pipe).trim();
            var title = line.slice(pipe + 1).trim();
            if (!left || !title) {
                continue;
            }
            var pathPrefix = parseLeftToPathPrefix(left);
            if (pathPrefix === null) {
                continue;
            }
            rules.push({ pathPrefix: pathPrefix, title: title });
        }
        return rules;
    }

    function parseRulesFromJson(text) {
        var arr = JSON.parse(text);
        if (!Array.isArray(arr)) {
            return [];
        }
        return arr.filter(function(r) {
            return r && typeof r.pathPrefix === 'string' && typeof r.title === 'string';
        }).map(function(r) {
            return { pathPrefix: normalizePrefix(r.pathPrefix), title: r.title };
        });
    }

    function parseRulesLegacy() {
        var raw = getPref('pathTabTitleRules', '');
        if (raw !== null && raw !== undefined && typeof raw !== 'string') {
            raw = String(raw);
        }
        var s = String(raw || '').trim();
        if (!s) {
            return [];
        }
        if (s[0] === '[') {
            try {
                return parseRulesFromJson(s);
            } catch (e) {
                return parseRulesFromLines(s);
            }
        }
        return parseRulesFromLines(s);
    }

    function parseRules() {
        var paired = parseRulesFromPairedFields();
        if (paired.length > 0) {
            return paired;
        }
        return parseRulesLegacy();
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
            var pn = r.pathPrefix;
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
