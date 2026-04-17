// ==UserScript==
// @name         Unified tab renamer
// @namespace    Wolf 2.0
// @version      1.0
// @description  Per-URL tab title + favicon: worksheet, schedule station, templates, pass-through; rules in prefs or saved locally
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"tabRenamerRulesJson":{"type":"string","group":"Rules","label":"Rules (JSON array)","description":"Array of {pathPrefix, mode, titleTemplate?, favicon?}. Modes: worksheet | station | template | pass_through. First matching pathPrefix wins—list specific paths first. Leave empty to use built-in defaults + any copy in local storage.","default":"","placeholder":"[{\"pathPrefix\":\"/alerts\",\"mode\":\"pass_through\",\"favicon\":\"🔔\"}]"},"tabRenamerShowEditor":{"type":"boolean","group":"Editor","label":"Show \"Tab rules\" button","description":"Floating button to edit rules and save to this browser (local storage).","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Unified%20tab%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Unified%20tab%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    var LS_RULES_KEY = 'dc_unified_tab_renamer_rules';

    var DEFAULT_RULES = [
        { pathPrefix: '/widgets/worksheet', mode: 'worksheet', titleTemplate: '{num} · {base}', favicon: '' },
        { pathPrefix: '/schedule', mode: 'station', titleTemplate: '{station} · {base}', favicon: '' },
        { pathPrefix: '/alerts', mode: 'pass_through', titleTemplate: '{base}', favicon: '' },
        { pathPrefix: '/ots', mode: 'pass_through', titleTemplate: '{base}', favicon: '' }
    ];

    /* ——— Worksheet ——— */
    var WORKSHEET_RE = /\bWorkSheet\b/i;
    var WS_NUM_RE = /^\s*WS\s*#?\s*(\d+)\s*$/i;
    var FOR_CURRENT_DATE_RE = /\s*for\s+current\s+date\s*/gi;
    var DATE_PATTERNS = [
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
        /\b\d{4}-\d{2}-\d{2}\b/g,
        /\b\d{1,2}-\d{1,2}-\d{2,4}\b/g,
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{2,4}\b/gi,
        /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{2,4}\b/gi
    ];

    /* ——— Station ——— */
    var COMBO = 'div[name="station"][role="combobox"]';
    var CODE_RE = /^[A-Z]{3}$/;
    var TITLE_PREFIX_RE = /^[A-Z]{3} · /;
    var IGNORE_CODES = { ABC: true };

    var baseTitleAtInject = document.title;
    var currentRule = null;
    var currentPathKey = location.pathname + location.search;

    var bodyMo = null;
    var headMo = null;
    var titleElObserver = null;
    var comboObservers = [];
    var faviconLinkEl = null;
    var editorEl = null;
    var editorBtn = null;
    var pathCheckTimer = null;
    var popStateHandler = null;
    var hashChangeHandler = null;

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

    function loadRules() {
        try {
            var ls = localStorage.getItem(LS_RULES_KEY);
            if (ls) {
                var a = JSON.parse(ls);
                if (Array.isArray(a) && a.length) {
                    return a;
                }
            }
        } catch (e) {}
        var pref = String(getPref('tabRenamerRulesJson', '') || '').trim();
        if (pref) {
            try {
                var b = JSON.parse(pref);
                if (Array.isArray(b)) {
                    return b;
                }
            } catch (e2) {}
        }
        return DEFAULT_RULES.slice();
    }

    function saveRulesToLocal(rules) {
        try {
            localStorage.setItem(LS_RULES_KEY, JSON.stringify(rules));
        } catch (e) {}
    }

    function findRuleForPath(pathname, rules) {
        var i;
        for (i = 0; i < rules.length; i++) {
            var p = String(rules[i].pathPrefix || '').trim();
            if (p && pathname.indexOf(p) === 0) {
                return rules[i];
            }
        }
        return null;
    }

    function rawTitleStorageKey() {
        return 'dc_unified_raw_title_' + location.pathname + location.search;
    }

    function readStoredRawTitle() {
        try {
            return sessionStorage.getItem(rawTitleStorageKey()) || '';
        } catch (e) {
            return '';
        }
    }

    function writeStoredRawTitle(raw) {
        if (!raw) {
            return;
        }
        try {
            sessionStorage.setItem(rawTitleStorageKey(), raw);
        } catch (e) {}
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

    function applyFavicon(rule) {
        var href = resolveTabIconHref(rule && rule.favicon);
        if (!href) {
            if (faviconLinkEl && faviconLinkEl.parentNode) {
                faviconLinkEl.parentNode.removeChild(faviconLinkEl);
            }
            faviconLinkEl = null;
            return;
        }
        if (!faviconLinkEl) {
            faviconLinkEl = document.createElement('link');
            faviconLinkEl.id = 'donkeycode-unified-tab-favicon';
            faviconLinkEl.rel = 'icon';
            (document.head || document.documentElement).appendChild(faviconLinkEl);
        }
        if (faviconLinkEl.getAttribute('href') !== href) {
            faviconLinkEl.setAttribute('href', href);
        }
    }

    function extractBaseGeneric(raw) {
        return stripDatesAndBoilerplate(String(raw || '')).replace(/\s+/g, ' ').trim();
    }

    /* ——— Worksheet helpers ——— */
    function stripDatesAndBoilerplate(s) {
        var t = s.replace(FOR_CURRENT_DATE_RE, ' ');
        var i;
        for (i = 0; i < DATE_PATTERNS.length; i++) {
            DATE_PATTERNS[i].lastIndex = 0;
            t = t.replace(DATE_PATTERNS[i], ' ');
        }
        return t.replace(/\s*[-–—|]\s*$/g, ' ').replace(/\s{2,}/g, ' ').trim();
    }

    function getWorksheetTemplate(rule) {
        var t = String((rule && rule.titleTemplate) || '{num} · {base}');
        if (t.indexOf('{base}') === -1) {
            t = t + '{base}';
        }
        return t;
    }

    function extractWorksheetNumber(t) {
        var m1 = t.match(/WorkSheet\s*#?\s*(\d+)/i);
        if (m1) {
            return m1[1];
        }
        var m2 = t.match(/(\d+)\s*[-–:#]?\s*WorkSheet/i);
        if (m2) {
            return m2[1];
        }
        var cleaned = stripDatesAndBoilerplate(t);
        var m3 = cleaned.match(/WorkSheet\s*#?\s*(\d+)/i);
        if (m3) {
            return m3[1];
        }
        var m4 = cleaned.match(/(\d+)\s*[-–:#]?\s*WorkSheet/i);
        if (m4) {
            return m4[1];
        }
        var after = cleaned.replace(/\bWorkSheet\b/gi, ' ');
        var m5 = after.match(/\b(\d{1,4})\b/);
        return m5 ? m5[1] : '';
    }

    function extractBaseTextWorksheet(raw) {
        var t = stripDatesAndBoilerplate(String(raw || ''));
        t = t.replace(/\bWorkSheet\b/gi, '');
        t = t.replace(/#?\s*\d{1,4}/g, '');
        return t.replace(/\s+/g, ' ').trim();
    }

    function extractBaseFromBuiltWorksheet(title, num, rule) {
        var tpl = getWorksheetTemplate(rule);
        var withNum = tpl.split('{num}').join(num || '0');
        var idx = withNum.indexOf('{base}');
        if (idx === -1) {
            return extractBaseTextWorksheet(title);
        }
        var pre = withNum.slice(0, idx);
        var post = withNum.slice(idx + 6);
        if (title.length >= pre.length + post.length &&
            title.indexOf(pre) === 0 &&
            title.lastIndexOf(post) === title.length - post.length) {
            return title.slice(pre.length, title.length - post.length);
        }
        return extractBaseTextWorksheet(title);
    }

    function shouldRewriteWorksheet(raw) {
        if (WS_NUM_RE.test(String(raw || '').trim())) {
            return true;
        }
        return WORKSHEET_RE.test(raw);
    }

    function buildWorksheetTitle(raw, rule) {
        var num = extractWorksheetNumber(raw);
        var base = extractBaseFromBuiltWorksheet(raw, num, rule);
        var tpl = getWorksheetTemplate(rule);
        var out = tpl.split('{num}').join(num || '').split('{base}').join(base);
        return out.replace(/\s+/g, ' ').trim() || (num ? num : 'Worksheet');
    }

    function getRawTitleWorksheet() {
        var cur = document.title;
        if (shouldRewriteWorksheet(cur)) {
            return cur;
        }
        var stored = readStoredRawTitle();
        if (stored && shouldRewriteWorksheet(stored)) {
            return stored;
        }
        return cur;
    }

    function applyWorksheetTitle(rule) {
        var raw = getRawTitleWorksheet();
        if (shouldRewriteWorksheet(raw)) {
            writeStoredRawTitle(raw);
        }
        var next = shouldRewriteWorksheet(raw) ? buildWorksheetTitle(raw, rule) : raw;
        if (next !== document.title) {
            document.title = next;
        }
    }

    /* ——— Station helpers ——— */
    function getStationTemplate(rule) {
        var t = String((rule && rule.titleTemplate) || '{station} · {base}');
        if (t.indexOf('{base}') === -1) {
            t = t + '{base}';
        }
        return t;
    }

    function pickCodeFromCombo(root) {
        var divider = root.querySelector('.divider.text, .text.divider');
        if (divider) {
            var t1 = divider.textContent.replace(/\s+/g, ' ').trim().toUpperCase();
            if (CODE_RE.test(t1)) {
                return t1;
            }
        }
        var selected = root.querySelector(
            '[role="option"][aria-selected="true"] .text, ' +
            '[role="option"][aria-checked="true"] .text, ' +
            '.item.active.selected .text, ' +
            '.item.selected.active .text'
        );
        if (selected) {
            var t2 = selected.textContent.replace(/\s+/g, ' ').trim().toUpperCase();
            if (CODE_RE.test(t2)) {
                return t2;
            }
        }
        return '';
    }

    function readStationCode() {
        var roots = document.querySelectorAll(COMBO);
        if (roots.length === 0) {
            return '';
        }
        var i;
        for (i = roots.length - 1; i >= 0; i--) {
            var c = pickCodeFromCombo(roots[i]);
            if (c) {
                return c;
            }
        }
        return '';
    }

    function shouldPrefixStation(code) {
        return Boolean(code) && !IGNORE_CODES[code];
    }

    function extractBaseFromStationTitle(rawTitle, code, rule) {
        if (!shouldPrefixStation(code)) {
            return rawTitle.replace(TITLE_PREFIX_RE, '');
        }
        var tpl = getStationTemplate(rule);
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

    function baseTitleStation(rule) {
        return extractBaseFromStationTitle(document.title, readStationCode(), rule);
    }

    function applyStationTitle(rule) {
        var code = readStationCode();
        var base = baseTitleStation(rule);
        if (!shouldPrefixStation(code)) {
            document.title = base;
            return;
        }
        var tpl = getStationTemplate(rule);
        document.title = tpl.split('{station}').join(code).split('{base}').join(base);
    }

    function ensureStationTitle(rule) {
        var code = readStationCode();
        var base = baseTitleStation(rule);
        if (!shouldPrefixStation(code)) {
            if (TITLE_PREFIX_RE.test(document.title)) {
                document.title = base;
            }
            return;
        }
        var tpl = getStationTemplate(rule);
        var next = tpl.split('{station}').join(code).split('{base}').join(base);
        if (document.title !== next) {
            document.title = next;
        }
    }

    /* ——— Template / generic ——— */
    function getGenericTemplate(rule) {
        return String((rule && rule.titleTemplate) || '{base}');
    }

    function applyTemplateMode(rule) {
        var raw = readStoredRawTitle();
        if (!raw) {
            raw = document.title;
            writeStoredRawTitle(raw);
        }
        var tpl = getGenericTemplate(rule);
        var next = tpl
            .split('{station}').join(readStationCode() || '')
            .split('{num}').join(extractWorksheetNumber(raw) || '')
            .split('{base}').join(extractBaseTextWorksheet(raw) || extractBaseGeneric(raw) || raw);
        if (next !== document.title) {
            document.title = next;
        }
    }

    function disconnectCombos() {
        comboObservers.forEach(function(o) {
            o.disconnect();
        });
        comboObservers.length = 0;
        document.querySelectorAll(COMBO + '[data-unified-tab-renamer-wired]').forEach(function(el) {
            delete el.dataset.unifiedTabRenamerWired;
        });
    }

    function disconnectTitleObserver() {
        if (titleElObserver) {
            titleElObserver.disconnect();
            titleElObserver = null;
        }
        var te = document.querySelector('title');
        if (te) {
            delete te.dataset.unifiedTabRenamerTitle;
        }
    }

    function disconnectBodyHead() {
        if (bodyMo) {
            bodyMo.disconnect();
            bodyMo = null;
        }
        if (headMo) {
            headMo.disconnect();
            headMo = null;
        }
    }

    function wireTitleElementWorksheet(rule) {
        var el = document.querySelector('title');
        if (!el || el.dataset.unifiedTabRenamerTitle) {
            return;
        }
        el.dataset.unifiedTabRenamerTitle = 'worksheet';
        titleElObserver = new MutationObserver(function() {
            requestAnimationFrame(function() {
                applyWorksheetTitle(rule);
            });
        });
        titleElObserver.observe(el, { childList: true, subtree: true, characterData: true });
    }

    function wireTitleElementStation(rule) {
        var el = document.querySelector('title');
        if (!el || el.dataset.unifiedTabRenamerTitle) {
            return;
        }
        el.dataset.unifiedTabRenamerTitle = 'station';
        titleElObserver = new MutationObserver(function() {
            requestAnimationFrame(function() {
                ensureStationTitle(rule);
            });
        });
        titleElObserver.observe(el, { childList: true, subtree: true, characterData: true });
    }

    function wireTitleElementTemplate(rule) {
        var el = document.querySelector('title');
        if (!el || el.dataset.unifiedTabRenamerTitle) {
            return;
        }
        el.dataset.unifiedTabRenamerTitle = 'template';
        titleElObserver = new MutationObserver(function() {
            requestAnimationFrame(function() {
                applyTemplateMode(rule);
            });
        });
        titleElObserver.observe(el, { childList: true, subtree: true, characterData: true });
    }

    function wireCombosStation() {
        document.querySelectorAll(COMBO).forEach(function(combo) {
            if (combo.dataset.unifiedTabRenamerWired) {
                return;
            }
            combo.dataset.unifiedTabRenamerWired = '1';
            var sub = new MutationObserver(function() {
                applyStationTitle(currentRule);
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

    function tick(rule) {
        if (!rule) {
            return;
        }
        var mode = String(rule.mode || 'pass_through').toLowerCase();
        if (mode === 'worksheet') {
            wireTitleElementWorksheet(rule);
            applyWorksheetTitle(rule);
        } else if (mode === 'station') {
            wireCombosStation();
            wireTitleElementStation(rule);
            applyStationTitle(rule);
        } else if (mode === 'template') {
            wireTitleElementTemplate(rule);
            applyTemplateMode(rule);
        } else {
            /* pass_through: title unchanged */
        }
        applyFavicon(rule);
    }

    function setupObservers(rule) {
        disconnectBodyHead();
        disconnectTitleObserver();
        disconnectCombos();

        var mode = String(rule.mode || 'pass_through').toLowerCase();

        if (mode === 'pass_through') {
            applyFavicon(rule);
            headMo = new MutationObserver(function() {
                applyFavicon(rule);
            });
            if (document.head) {
                headMo.observe(document.head, { childList: true, subtree: true });
            }
            return;
        }

        bodyMo = new MutationObserver(function() {
            tick(rule);
        });
        headMo = new MutationObserver(function() {
            tick(rule);
        });
        bodyMo.observe(document.body, { childList: true, subtree: true });
        if (document.head) {
            headMo.observe(document.head, { childList: true, subtree: true });
        }
        tick(rule);
    }

    function teardownUi() {
        if (editorBtn && editorBtn.parentNode) {
            editorBtn.parentNode.removeChild(editorBtn);
        }
        editorBtn = null;
        if (editorEl && editorEl.parentNode) {
            editorEl.parentNode.removeChild(editorEl);
        }
        editorEl = null;
    }

    function buildEditor(ruleList) {
        teardownUi();
        if (!getPref('tabRenamerShowEditor', true)) {
            return;
        }
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Tab rules';
        btn.setAttribute('aria-label', 'Edit unified tab renamer rules');
        btn.id = 'dc-unified-tab-renamer-open';
        btn.style.cssText = [
            'position:fixed', 'bottom:12px', 'right:12px', 'z-index:2147483646',
            'padding:8px 12px', 'font:13px system-ui,sans-serif', 'cursor:pointer',
            'border-radius:8px', 'border:1px solid #444', 'background:#1e1e2e', 'color:#eee',
            'box-shadow:0 2px 8px rgba(0,0,0,.35)'
        ].join(';');
        btn.addEventListener('click', function() {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });
        var panel = document.createElement('div');
        panel.id = 'dc-unified-tab-renamer-panel';
        panel.style.cssText = [
            'display:none', 'position:fixed', 'bottom:52px', 'right:12px', 'z-index:2147483646',
            'width:min(520px,calc(100vw - 24px))', 'max-height:70vh', 'overflow:auto',
            'padding:12px', 'background:#111', 'color:#eee', 'border:1px solid #444',
            'border-radius:10px', 'font:13px/1.4 system-ui,sans-serif',
            'box-shadow:0 4px 24px rgba(0,0,0,.45)'
        ].join(';');
        var ta = document.createElement('textarea');
        ta.value = JSON.stringify(ruleList, null, 2);
        ta.style.cssText = 'width:100%;min-height:220px;box-sizing:border-box;font:12px monospace;background:#1a1a1a;color:#ddd;border:1px solid #555;border-radius:6px;padding:8px';
        var hint = document.createElement('p');
        hint.style.margin = '8px 0 0 0';
        hint.innerHTML = 'Modes: <code>worksheet</code>, <code>station</code>, <code>template</code>, <code>pass_through</code> (title unchanged; favicon only). ' +
            'Save stores to <strong>local storage</strong> for this site and overrides the pref until cleared.';
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap';
        var save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Save';
        save.style.cssText = 'padding:6px 14px;cursor:pointer';
        var reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = 'Reset to built-in defaults';
        reset.style.cssText = 'padding:6px 14px;cursor:pointer';
        var clearLs = document.createElement('button');
        clearLs.type = 'button';
        clearLs.textContent = 'Clear local storage';
        clearLs.style.cssText = 'padding:6px 14px;cursor:pointer';
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.style.cssText = 'padding:6px 14px;cursor:pointer;margin-left:auto';
        save.addEventListener('click', function() {
            try {
                var parsed = JSON.parse(ta.value);
                if (!Array.isArray(parsed)) {
                    throw new Error('JSON must be an array');
                }
                saveRulesToLocal(parsed);
                panel.style.display = 'none';
                reinit();
            } catch (err) {
                alert('Invalid JSON: ' + (err && err.message));
            }
        });
        reset.addEventListener('click', function() {
            ta.value = JSON.stringify(DEFAULT_RULES, null, 2);
        });
        clearLs.addEventListener('click', function() {
            try {
                localStorage.removeItem(LS_RULES_KEY);
            } catch (e) {}
            ta.value = JSON.stringify(loadRules(), null, 2);
            reinit();
        });
        close.addEventListener('click', function() {
            panel.style.display = 'none';
        });
        row.appendChild(save);
        row.appendChild(reset);
        row.appendChild(clearLs);
        row.appendChild(close);
        panel.appendChild(hint);
        panel.appendChild(ta);
        panel.appendChild(row);
        document.body.appendChild(panel);
        document.body.appendChild(btn);
        editorEl = panel;
        editorBtn = btn;
    }

    function reinit() {
        var rules = loadRules();
        var rule = findRuleForPath(location.pathname, rules);
        currentRule = rule;
        currentPathKey = location.pathname + location.search;

        disconnectBodyHead();
        disconnectTitleObserver();
        disconnectCombos();
        if (faviconLinkEl && faviconLinkEl.parentNode) {
            faviconLinkEl.parentNode.removeChild(faviconLinkEl);
        }
        faviconLinkEl = null;

        if (!rule) {
            teardownUi();
            buildEditor(rules);
            return;
        }

        baseTitleAtInject = document.title;
        setupObservers(rule);
        buildEditor(rules);
    }

    function checkPathChanged() {
        var key = location.pathname + location.search;
        if (key !== currentPathKey) {
            reinit();
        }
    }

    reinit();

    pathCheckTimer = setInterval(checkPathChanged, 1000);
    popStateHandler = function() {
        checkPathChanged();
    };
    window.addEventListener('popstate', popStateHandler);
    hashChangeHandler = function() {
        checkPathChanged();
    };
    window.addEventListener('hashchange', hashChangeHandler);

    window.__myScriptCleanup = function() {
        if (pathCheckTimer) {
            clearInterval(pathCheckTimer);
            pathCheckTimer = null;
        }
        if (popStateHandler) {
            window.removeEventListener('popstate', popStateHandler);
            popStateHandler = null;
        }
        if (hashChangeHandler) {
            window.removeEventListener('hashchange', hashChangeHandler);
            hashChangeHandler = null;
        }
        disconnectBodyHead();
        disconnectTitleObserver();
        disconnectCombos();
        if (faviconLinkEl && faviconLinkEl.parentNode) {
            faviconLinkEl.parentNode.removeChild(faviconLinkEl);
        }
        faviconLinkEl = null;
        teardownUi();

        var rule = currentRule;
        if (!rule) {
            document.title = baseTitleAtInject;
            return;
        }
        var mode = String(rule.mode || 'pass_through').toLowerCase();
        if (mode === 'worksheet') {
            var stored = readStoredRawTitle();
            if (stored && shouldRewriteWorksheet(stored)) {
                document.title = stored;
            } else if (shouldRewriteWorksheet(baseTitleAtInject)) {
                document.title = baseTitleAtInject;
            } else {
                document.title = baseTitleAtInject;
            }
        } else if (mode === 'station') {
            document.title = baseTitleStation(rule);
        } else if (mode === 'template') {
            var sr = readStoredRawTitle();
            document.title = sr || baseTitleAtInject;
        } else {
            document.title = baseTitleAtInject;
        }
    };
})();
