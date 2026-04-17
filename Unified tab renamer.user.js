// ==UserScript==
// @name         Unified tab renamer
// @namespace    Wolf 2.0
// @version      1.2
// @description  Per-URL tab title + favicon: worksheet, schedule station, templates, pass-through; configure in DonkeyCODE prefs (mirrored locally)
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"tabRenamerUseCustomRules":{"type":"boolean","group":"Tab rules","label":"Use custom rules below","description":"When off, built-in rules apply (worksheet, schedule, /alerts, /ots). When on, only the rules you fill in (Rule 1–8) are used—first matching path wins. Leave a rule’s path empty to skip that slot. Saving in DonkeyCODE stores these values; this script also keeps a backup copy in the browser for this site.","default":false}}
// @donkeycode-pref {"tabRenamerRule1Path":{"type":"string","group":"Rule 1","label":"Path contains","description":"Tab URL path must start with this (e.g. /widgets/worksheet). Empty = skip this slot.","default":"","placeholder":"/widgets/worksheet"},"tabRenamerRule1Mode":{"type":"select","group":"Rule 1","label":"Mode","description":"Worksheet: {num} {base}. Station: {station} {base}. Template: any placeholders. Pass-through: title unchanged; set favicon only.","default":"worksheet","options":[{"value":"worksheet","label":"Worksheet"},{"value":"station","label":"Schedule station"},{"value":"template","label":"Template"},{"value":"pass_through","label":"Pass-through (favicon only)"}]},"tabRenamerRule1Title":{"type":"string","group":"Rule 1","label":"Title template","description":"Placeholders: {num} {base} {station}. Worksheet/station defaults apply if left empty.","default":"","placeholder":"{num} · {base}"},"tabRenamerRule1Favicon":{"type":"string","group":"Rule 1","label":"Tab icon","description":"Emoji or image URL. Empty = site default.","default":"","placeholder":"📋"}}
// @donkeycode-pref {"tabRenamerRule2Path":{"type":"string","group":"Rule 2","label":"Path contains","default":"","placeholder":"/schedule"},"tabRenamerRule2Mode":{"type":"select","group":"Rule 2","label":"Mode","default":"station","options":[{"value":"worksheet","label":"Worksheet"},{"value":"station","label":"Schedule station"},{"value":"template","label":"Template"},{"value":"pass_through","label":"Pass-through (favicon only)"}]},"tabRenamerRule2Title":{"type":"string","group":"Rule 2","label":"Title template","default":"","placeholder":"{station} · {base}"},"tabRenamerRule2Favicon":{"type":"string","group":"Rule 2","label":"Tab icon","default":"","placeholder":""}}
// @donkeycode-pref {"tabRenamerRule3Path":{"type":"string","group":"Rule 3","label":"Path contains","default":"","placeholder":"/alerts"},"tabRenamerRule3Mode":{"type":"select","group":"Rule 3","label":"Mode","default":"pass_through","options":[{"value":"worksheet","label":"Worksheet"},{"value":"station","label":"Schedule station"},{"value":"template","label":"Template"},{"value":"pass_through","label":"Pass-through (favicon only)"}]},"tabRenamerRule3Title":{"type":"string","group":"Rule 3","label":"Title template","default":"","placeholder":"{base}"},"tabRenamerRule3Favicon":{"type":"string","group":"Rule 3","label":"Tab icon","default":"","placeholder":"🔔"}}
// @donkeycode-pref {"tabRenamerRule4Path":{"type":"string","group":"Rule 4","label":"Path contains","default":"","placeholder":"/ots"},"tabRenamerRule4Mode":{"type":"select","group":"Rule 4","label":"Mode","default":"pass_through","options":[{"value":"worksheet","label":"Worksheet"},{"value":"station","label":"Schedule station"},{"value":"template","label":"Template"},{"value":"pass_through","label":"Pass-through (favicon only)"}]},"tabRenamerRule4Title":{"type":"string","group":"Rule 4","label":"Title template","default":"","placeholder":"{base}"},"tabRenamerRule4Favicon":{"type":"string","group":"Rule 4","label":"Tab icon","default":"","placeholder":""}}
// @donkeycode-pref {"tabRenamerRule5Path":{"type":"string","group":"Rule 5","label":"Path contains","default":"","placeholder":""},"tabRenamerRule5Mode":{"type":"select","group":"Rule 5","label":"Mode","default":"template","options":[{"value":"worksheet","label":"Worksheet"},{"value":"station","label":"Schedule station"},{"value":"template","label":"Template"},{"value":"pass_through","label":"Pass-through (favicon only)"}]},"tabRenamerRule5Title":{"type":"string","group":"Rule 5","label":"Title template","default":"","placeholder":"{base}"},"tabRenamerRule5Favicon":{"type":"string","group":"Rule 5","label":"Tab icon","default":"","placeholder":""}}
// @donkeycode-pref {"tabRenamerRule6Path":{"type":"string","group":"Rule 6","label":"Path contains","default":"","placeholder":""},"tabRenamerRule6Mode":{"type":"select","group":"Rule 6","label":"Mode","default":"template","options":[{"value":"worksheet","label":"Worksheet"},{"value":"station","label":"Schedule station"},{"value":"template","label":"Template"},{"value":"pass_through","label":"Pass-through (favicon only)"}]},"tabRenamerRule6Title":{"type":"string","group":"Rule 6","label":"Title template","default":"","placeholder":"{base}"},"tabRenamerRule6Favicon":{"type":"string","group":"Rule 6","label":"Tab icon","default":"","placeholder":""}}
// @donkeycode-pref {"tabRenamerRule7Path":{"type":"string","group":"Rule 7","label":"Path contains","default":"","placeholder":""},"tabRenamerRule7Mode":{"type":"select","group":"Rule 7","label":"Mode","default":"template","options":[{"value":"worksheet","label":"Worksheet"},{"value":"station","label":"Schedule station"},{"value":"template","label":"Template"},{"value":"pass_through","label":"Pass-through (favicon only)"}]},"tabRenamerRule7Title":{"type":"string","group":"Rule 7","label":"Title template","default":"","placeholder":"{base}"},"tabRenamerRule7Favicon":{"type":"string","group":"Rule 7","label":"Tab icon","default":"","placeholder":""}}
// @donkeycode-pref {"tabRenamerRule8Path":{"type":"string","group":"Rule 8","label":"Path contains","default":"","placeholder":""},"tabRenamerRule8Mode":{"type":"select","group":"Rule 8","label":"Mode","default":"template","options":[{"value":"worksheet","label":"Worksheet"},{"value":"station","label":"Schedule station"},{"value":"template","label":"Template"},{"value":"pass_through","label":"Pass-through (favicon only)"}]},"tabRenamerRule8Title":{"type":"string","group":"Rule 8","label":"Title template","default":"","placeholder":"{base}"},"tabRenamerRule8Favicon":{"type":"string","group":"Rule 8","label":"Tab icon","default":"","placeholder":""}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Unified%20tab%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Unified%20tab%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

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
    var pathCheckTimer = null;
    var popStateHandler = null;
    var hashChangeHandler = null;

    var PREF_MIRROR_KEY = 'dc_unified_tab_renamer_prefs_mirror';

    var ALL_PREF_KEYS = [
        'tabRenamerUseCustomRules',
        'tabRenamerRule1Path', 'tabRenamerRule1Mode', 'tabRenamerRule1Title', 'tabRenamerRule1Favicon',
        'tabRenamerRule2Path', 'tabRenamerRule2Mode', 'tabRenamerRule2Title', 'tabRenamerRule2Favicon',
        'tabRenamerRule3Path', 'tabRenamerRule3Mode', 'tabRenamerRule3Title', 'tabRenamerRule3Favicon',
        'tabRenamerRule4Path', 'tabRenamerRule4Mode', 'tabRenamerRule4Title', 'tabRenamerRule4Favicon',
        'tabRenamerRule5Path', 'tabRenamerRule5Mode', 'tabRenamerRule5Title', 'tabRenamerRule5Favicon',
        'tabRenamerRule6Path', 'tabRenamerRule6Mode', 'tabRenamerRule6Title', 'tabRenamerRule6Favicon',
        'tabRenamerRule7Path', 'tabRenamerRule7Mode', 'tabRenamerRule7Title', 'tabRenamerRule7Favicon',
        'tabRenamerRule8Path', 'tabRenamerRule8Mode', 'tabRenamerRule8Title', 'tabRenamerRule8Favicon'
    ];

    function readPrefMirror() {
        try {
            var raw = localStorage.getItem(PREF_MIRROR_KEY);
            if (!raw) {
                return null;
            }
            var o = JSON.parse(raw);
            return o && typeof o === 'object' ? o : null;
        } catch (e) {
            return null;
        }
    }

    /** Raw value from DonkeyCODE, or undefined if missing / no API */
    function getPrefRaw(key) {
        if (typeof donkeycodeGetPref !== 'function') {
            return undefined;
        }
        return donkeycodeGetPref(key);
    }

    /**
     * Prefer injected prefs; if a key is missing (undefined/null), use last saved mirror so
     * rules survive across sessions and when prefs sync is delayed.
     */
    function getPrefMirrored(key, def) {
        var v = getPrefRaw(key);
        if (v !== undefined && v !== null) {
            if (typeof v === 'boolean') {
                return v;
            }
            return v;
        }
        var snap = readPrefMirror();
        if (snap && Object.prototype.hasOwnProperty.call(snap, key)) {
            var m = snap[key];
            if (m !== undefined && m !== null) {
                return m;
            }
        }
        return def;
    }

    function persistPrefMirror() {
        var snap = readPrefMirror() || {};
        var i;
        for (i = 0; i < ALL_PREF_KEYS.length; i++) {
            var k = ALL_PREF_KEYS[i];
            var v = getPrefRaw(k);
            if (v !== undefined && v !== null) {
                snap[k] = v;
            }
        }
        try {
            localStorage.setItem(PREF_MIRROR_KEY, JSON.stringify(snap));
        } catch (e) {}
    }

    function loadRulesFromPrefs() {
        var useCustom = !!getPrefMirrored('tabRenamerUseCustomRules', false);
        if (!useCustom) {
            return DEFAULT_RULES.slice();
        }
        var rules = [];
        var i;
        for (i = 1; i <= 8; i++) {
            var path = String(getPrefMirrored('tabRenamerRule' + i + 'Path', '') || '').trim();
            if (!path) {
                continue;
            }
            var mode = String(getPrefMirrored('tabRenamerRule' + i + 'Mode', 'template') || 'template')
                .toLowerCase()
                .replace(/-/g, '_');
            rules.push({
                pathPrefix: path,
                mode: mode,
                titleTemplate: String(getPrefMirrored('tabRenamerRule' + i + 'Title', '') || '').trim(),
                favicon: String(getPrefMirrored('tabRenamerRule' + i + 'Favicon', '') || '').trim()
            });
        }
        if (rules.length === 0) {
            return DEFAULT_RULES.slice();
        }
        return rules;
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
        var t = (rule && rule.titleTemplate) ? String(rule.titleTemplate).trim() : '';
        if (!t) {
            t = '{num} · {base}';
        }
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
        var t = (rule && rule.titleTemplate) ? String(rule.titleTemplate).trim() : '';
        if (!t) {
            t = '{station} · {base}';
        }
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
        var t = (rule && rule.titleTemplate) ? String(rule.titleTemplate).trim() : '';
        return t || '{base}';
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

    function reinit() {
        persistPrefMirror();
        var rules = loadRulesFromPrefs();
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
            return;
        }

        baseTitleAtInject = document.title;
        setupObservers(rule);
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
