// ==UserScript==
// @name         Worksheet Tab Title
// @namespace    Wolf 2.0
// @version      1.0
// @description  Shorten WorkSheet→WS in tab title, drop “for current date”, keep numbers
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20Tab%20Title.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20Tab%20Title.user.js
// ==/UserScript==

(function() {
    'use strict';

    const FOR_CURRENT_DATE_RE = /\s*for\s+current\s+date\s*/gi;
    const WORKSHEET_WORD_RE = /\bWorkSheet\b/gi;

    let titleElObserver = null;

    function transformTitle(raw) {
        let t = String(raw || '');
        t = t.replace(FOR_CURRENT_DATE_RE, ' ').replace(/\s{2,}/g, ' ').trim();
        if (WORKSHEET_WORD_RE.test(t)) {
            WORKSHEET_WORD_RE.lastIndex = 0;
            t = t.replace(WORKSHEET_WORD_RE, 'WS');
        }
        t = t.replace(/\s{2,}/g, ' ').trim();
        return t;
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
    };
})();
