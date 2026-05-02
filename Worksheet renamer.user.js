// ==UserScript==
// @name         Worksheet renamer
// @namespace    Wolf 2.0
// @version      2.8
// @description  Rename worksheet tab title; short poll then lightweight <title> watch; optional favicon
// @match        https://opssuitemain.swacorp.com/widgets/worksheet
// @donkeycode-pref {"worksheetTitleTemplate":{"type":"string","group":"Tab title","label":"Title template","description":"Use {num} and optionally {base} (rest of title, dates stripped). Omit {base} for a fixed label only, e.g. WS {num}.","default":"{num} · {base}"},"worksheetFaviconUrl":{"type":"string","group":"Tab icon","label":"Tab icon (emoji or URL)","description":"Paste one emoji (e.g. 📋) or a full image URL (https://… or data:…). Leave empty for the default site icon. Mirrored in localStorage (donkeycode.mirror.worksheetFaviconUrl) when set so cloud sync cannot drop it.","default":"","placeholder":"📋 or https://…"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20renamer.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20renamer.user.js
// ==/UserScript==

(function() {
    'use strict';

    const WORKSHEET_RE = /\bWorkSheet\b/i;
    const WS_NUM_RE = /^\s*WS\s*#?\s*(\d+)\s*$/i;

    var baseTitleAtInject = document.title;

    var rawTitleStorageKey = 'dc_worksheet_raw_title_' + location.pathname + location.search;

    const FOR_CURRENT_DATE_RE = /\s*for\s+current\s+date\s*/gi;
    const DATE_PATTERNS = [
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
        /\b\d{4}-\d{2}-\d{2}\b/g,
        /\b\d{1,2}-\d{1,2}-\d{2,4}\b/g,
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{2,4}\b/gi,
        /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{2,4}\b/gi
    ];

    var faviconLinkEl = null;
    var renameComplete = false;
    var lastTitleSetByUs = '';
    var pollTimer = null;
    var pollAttempts = 0;
    var titleMo = null;
    var titleDebounce = null;
    /** ~12s window to catch async app title; no MutationObservers after this. */
    var POLL_MS = 300;
    var MAX_POLLS = 40;

    var FAVICON_MIRROR_KEY = 'donkeycode.mirror.worksheetFaviconUrl';

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

    /** DonkeyCODE prefs + localStorage mirror so emoji/URL survives empty cloud merge. */
    function getFaviconPref() {
        var raw = typeof donkeycodeGetPref === 'function' ? donkeycodeGetPref('worksheetFaviconUrl') : '';
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

    function getTemplate() {
        return String(getPref('worksheetTitleTemplate', '{num} · {base}') || '{num} · {base}');
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
        if (!shouldRewrite(raw)) {
            return;
        }
        writeStoredRawTitle(raw);
        var next = transformTitle(raw);
        if (!next) {
            return;
        }
        lastTitleSetByUs = next;
        document.title = next;
        if (!renameComplete) {
            renameComplete = true;
            stopPoll();
        }
    }

    function scheduleTitleReapply() {
        if (titleDebounce) {
            clearTimeout(titleDebounce);
        }
        titleDebounce = setTimeout(function() {
            titleDebounce = null;
            var cur = document.title;
            if (cur === lastTitleSetByUs) {
                return;
            }
            applyTitle();
            applyFavicon();
        }, 200);
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

    function applyFavicon() {
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
            faviconLinkEl.id = 'donkeycode-worksheet-favicon';
            faviconLinkEl.rel = 'icon';
            document.head.appendChild(faviconLinkEl);
        }
        if (faviconLinkEl.getAttribute('href') !== href) {
            faviconLinkEl.setAttribute('href', href);
        }
    }

    function stopPoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function pollTick() {
        applyTitle();
        applyFavicon();
        if (renameComplete) {
            return;
        }
        pollAttempts++;
        if (pollAttempts >= MAX_POLLS) {
            stopPoll();
        }
    }

    pollTick();
    if (!renameComplete) {
        pollTimer = setInterval(pollTick, POLL_MS);
    }

    var titleEl = document.querySelector('title');
    if (titleEl) {
        titleMo = new MutationObserver(function() {
            scheduleTitleReapply();
        });
        titleMo.observe(titleEl, { childList: true, subtree: true, characterData: true });
    }

    window.__myScriptCleanup = function() {
        stopPoll();
        if (titleMo) {
            titleMo.disconnect();
            titleMo = null;
        }
        if (titleDebounce) {
            clearTimeout(titleDebounce);
            titleDebounce = null;
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
