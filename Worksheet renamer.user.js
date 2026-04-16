// ==UserScript==
// @name         Worksheet renamer
// @namespace    Wolf 2.0
// @version      2.1
// @description  Rename worksheet widget tab title; placeholders in prefs; optional favicon
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @donkeycode-pref {"worksheetTitleTemplate":{"type":"string","group":"Tab title","label":"Title template","description":"Use {num} for worksheet number, {base} for the rest of the title (dates/boilerplate stripped). Example: WS {num} — {base}","default":"{num} · {base}"},"worksheetFaviconUrl":{"type":"url","group":"Tab icon","label":"Custom favicon URL","description":"Shown in the tab; leave empty to keep the site icon. Data URLs work if your browser allows them.","default":"","placeholder":"https://… or data:image/…"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    const WORKSHEET_RE = /\bWorkSheet\b/i;
    const WS_NUM_RE = /^\s*WS\s*#?\s*(\d+)\s*$/i;

    var baseTitleAtInject = document.title;

    /** Last app-emitted title before our rename; survives script refresh so prefs re-apply correctly. */
    var rawTitleStorageKey = 'dc_worksheet_raw_title_' + location.pathname + location.search;

    const FOR_CURRENT_DATE_RE = /\s*for\s+current\s+date\s*/gi;
    const DATE_PATTERNS = [
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
        /\b\d{4}-\d{2}-\d{2}\b/g,
        /\b\d{1,2}-\d{1,2}-\d{2,4}\b/g,
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{2,4}\b/gi,
        /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{2,4}\b/gi
    ];

    let titleElObserver = null;
    var faviconLinkEl = null;

    function readStoredRawTitle() {
        try {
            return sessionStorage.getItem(rawTitleStorageKey) || '';
        } catch (e) {
            return '';
        }
    }

    function writeStoredRawTitle(raw) {
        if (!raw || !shouldRewrite(raw)) {
            return;
        }
        try {
            sessionStorage.setItem(rawTitleStorageKey, raw);
        } catch (e) {}
    }

    /** Prefer live app title; if the tab already shows our formatted title, use stored raw. */
    function getRawTitleForTransform() {
        var cur = document.title;
        if (shouldRewrite(cur)) {
            return cur;
        }
        var stored = readStoredRawTitle();
        if (stored && shouldRewrite(stored)) {
            return stored;
        }
        return cur;
    }

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
        var t = String(getPref('worksheetTitleTemplate', '{num} · {base}') || '{num} · {base}');
        if (t.indexOf('{base}') === -1) {
            t = t + '{base}';
        }
        return t;
    }

    function stripDatesAndBoilerplate(s) {
        let t = s.replace(FOR_CURRENT_DATE_RE, ' ');
        for (let i = 0; i < DATE_PATTERNS.length; i++) {
            DATE_PATTERNS[i].lastIndex = 0;
            t = t.replace(DATE_PATTERNS[i], ' ');
        }
        t = t.replace(/\s*[-–—|]\s*$/g, ' ').replace(/\s{2,}/g, ' ').trim();
        return t;
    }

    function extractWorksheetNumber(t) {
        const m1 = t.match(/WorkSheet\s*#?\s*(\d+)/i);
        if (m1) {
            return m1[1];
        }
        const m2 = t.match(/(\d+)\s*[-–:#]?\s*WorkSheet/i);
        if (m2) {
            return m2[1];
        }
        const cleaned = stripDatesAndBoilerplate(t);
        const m3 = cleaned.match(/WorkSheet\s*#?\s*(\d+)/i);
        if (m3) {
            return m3[1];
        }
        const m4 = cleaned.match(/(\d+)\s*[-–:#]?\s*WorkSheet/i);
        if (m4) {
            return m4[1];
        }
        const after = cleaned.replace(/\bWorkSheet\b/gi, ' ');
        const m5 = after.match(/\b(\d{1,4})\b/);
        return m5 ? m5[1] : '';
    }

    function extractBaseText(raw) {
        var t = stripDatesAndBoilerplate(String(raw || ''));
        t = t.replace(/\bWorkSheet\b/gi, '');
        t = t.replace(/#?\s*\d{1,4}/g, '');
        return t.replace(/\s+/g, ' ').trim();
    }

    function extractBaseFromBuiltTitle(title, num) {
        var tpl = getTemplate();
        var withNum = tpl.split('{num}').join(num || '0');
        var idx = withNum.indexOf('{base}');
        if (idx === -1) {
            return extractBaseText(title);
        }
        var pre = withNum.slice(0, idx);
        var post = withNum.slice(idx + 6);
        if (title.length >= pre.length + post.length &&
            title.indexOf(pre) === 0 &&
            title.lastIndexOf(post) === title.length - post.length) {
            return title.slice(pre.length, title.length - post.length);
        }
        return extractBaseText(title);
    }

    function shouldRewrite(raw) {
        if (WS_NUM_RE.test(String(raw || '').trim())) {
            return true;
        }
        return WORKSHEET_RE.test(raw);
    }

    function buildTitle(raw) {
        var num = extractWorksheetNumber(raw);
        var base = extractBaseFromBuiltTitle(raw, num);
        var tpl = getTemplate();
        var out = tpl.split('{num}').join(num || '').split('{base}').join(base);
        return out.replace(/\s+/g, ' ').trim() || (num ? num : 'Worksheet');
    }

    function transformTitle(raw) {
        var t = String(raw || '').trim();
        if (!shouldRewrite(t)) {
            return t;
        }
        return buildTitle(t);
    }

    function applyTitle() {
        var raw = getRawTitleForTransform();
        writeStoredRawTitle(raw);
        var next = transformTitle(raw);
        if (next !== document.title) {
            document.title = next;
        }
    }

    function applyFavicon() {
        var url = String(getPref('worksheetFaviconUrl', '') || '').trim();
        if (!url) {
            if (faviconLinkEl && faviconLinkEl.parentNode) {
                faviconLinkEl.parentNode.removeChild(faviconLinkEl);
            }
            faviconLinkEl = null;
            return;
        }
        if (!faviconLinkEl) {
            faviconLinkEl = document.createElement('link');
            faviconLinkEl.id = 'donkeycode-worksheet-favicon';
            faviconLinkEl.rel = 'icon';
            document.head.appendChild(faviconLinkEl);
        }
        if (faviconLinkEl.getAttribute('href') !== url) {
            faviconLinkEl.setAttribute('href', url);
        }
    }

    function wireTitleElement() {
        const el = document.querySelector('title');
        if (!el || el.dataset.worksheetRenamerWired) {
            return;
        }
        el.dataset.worksheetRenamerWired = '1';
        titleElObserver = new MutationObserver(function() {
            requestAnimationFrame(applyTitle);
        });
        titleElObserver.observe(el, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    const headMo = new MutationObserver(function() {
        wireTitleElement();
        applyTitle();
        applyFavicon();
    });

    const bodyMo = new MutationObserver(function() {
        wireTitleElement();
        applyTitle();
        applyFavicon();
    });

    bodyMo.observe(document.body, { childList: true, subtree: true });
    if (document.head) {
        headMo.observe(document.head, { childList: true, subtree: true });
    }
    wireTitleElement();
    applyTitle();
    applyFavicon();

    window.__myScriptCleanup = function() {
        bodyMo.disconnect();
        headMo.disconnect();
        if (titleElObserver) {
            titleElObserver.disconnect();
            titleElObserver = null;
        }
        const t = document.querySelector('title');
        if (t) {
            delete t.dataset.worksheetRenamerWired;
        }
        var stored = readStoredRawTitle();
        if (stored && shouldRewrite(stored)) {
            document.title = stored;
        } else if (shouldRewrite(baseTitleAtInject)) {
            document.title = baseTitleAtInject;
        } else {
            var cur = document.title;
            var numGuess = (cur.match(/^[\s]*(\d{1,4})\b/) || [])[1] || '';
            var base = extractBaseFromBuiltTitle(cur, numGuess);
            document.title = (base && base.length) ? base : baseTitleAtInject;
        }
        if (faviconLinkEl && faviconLinkEl.parentNode) {
            faviconLinkEl.parentNode.removeChild(faviconLinkEl);
        }
        faviconLinkEl = null;
    };
})();
