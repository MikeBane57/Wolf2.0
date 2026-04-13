// ==UserScript==
// @name         Worksheet Tab Title
// @namespace    Wolf 2.0
// @version      1.3
// @description  Tab title → WS n when WorkSheet appears; strip dates and extra text
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20Tab%20Title.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20Tab%20Title.user.js
// ==/UserScript==

(function() {
    'use strict';

    const WORKSHEET_RE = /\bWorkSheet\b/i;
    var baseTitleAtInject = document.title;
    /** Already normalized by this script (WS 12) */
    const WS_NUM_RE = /^\s*WS\s*#?\s*(\d+)\s*$/i;

    const FOR_CURRENT_DATE_RE = /\s*for\s+current\s+date\s*/gi;
    const DATE_PATTERNS = [
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
        /\b\d{4}-\d{2}-\d{2}\b/g,
        /\b\d{1,2}-\d{1,2}-\d{2,4}\b/g,
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{2,4}\b/gi,
        /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{2,4}\b/gi
    ];

    let titleElObserver = null;

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
        if (m1) return m1[1];
        const m2 = t.match(/(\d+)\s*[-–:#]?\s*WorkSheet/i);
        if (m2) return m2[1];
        const cleaned = stripDatesAndBoilerplate(t);
        const m3 = cleaned.match(/WorkSheet\s*#?\s*(\d+)/i);
        if (m3) return m3[1];
        const m4 = cleaned.match(/(\d+)\s*[-–:#]?\s*WorkSheet/i);
        if (m4) return m4[1];
        const after = cleaned.replace(/\bWorkSheet\b/gi, ' ');
        const m5 = after.match(/\b(\d{1,4})\b/);
        return m5 ? m5[1] : '';
    }

    function transformTitle(raw) {
        const t = String(raw || '').trim();
        if (WS_NUM_RE.test(t)) {
            const n = t.match(WS_NUM_RE)[1];
            return `WS ${n}`;
        }
        if (!WORKSHEET_RE.test(t)) {
            return t;
        }
        const num = extractWorksheetNumber(t);
        return num ? `WS ${num}` : 'WS';
    }

    function applyTitle() {
        const current = document.title;
        const next = transformTitle(current);
        if (next !== current) {
            document.title = next;
        }
    }

    function wireTitleElement() {
        const el = document.querySelector('title');
        if (!el || el.dataset.worksheetTabTitleWired) return;
        el.dataset.worksheetTabTitleWired = '1';
        titleElObserver = new MutationObserver(() => {
            requestAnimationFrame(applyTitle);
        });
        titleElObserver.observe(el, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    const bodyMo = new MutationObserver(() => {
        wireTitleElement();
        applyTitle();
    });

    bodyMo.observe(document.body, { childList: true, subtree: true });
    wireTitleElement();
    applyTitle();

    window.__myScriptCleanup = function() {
        bodyMo.disconnect();
        if (titleElObserver) {
            titleElObserver.disconnect();
            titleElObserver = null;
        }
        const t = document.querySelector('title');
        if (t) delete t.dataset.worksheetTabTitleWired;
        var cur = document.title;
        var stripped = cur.replace(/^\s*WS(?:\s*#?\s*\d+)?\s*·?\s*/i, '').trim();
        document.title = stripped || baseTitleAtInject;
    };
})();
