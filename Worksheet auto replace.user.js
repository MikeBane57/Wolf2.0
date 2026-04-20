// ==UserScript==
// @name         Worksheet auto replace
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  Worksheet: optional watch on Tails / Lines / Flights counts; when any change, click Replace automatically. Toggle sits under the toolbar buttons.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        none
// @donkeycode-pref {"worksheetAutoReplacePollMs":{"type":"number","group":"Auto replace","label":"Check interval (ms)","description":"How often to re-read counts from the page while the watch is on.","default":800,"min":200,"max":10000,"step":100}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20auto%20replace.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20auto%20replace.user.js
// ==/UserScript==

(function () {
    'use strict';

    var HOST_ID = 'dc-worksheet-auto-replace-host';
    var STYLE_ID = 'dc-worksheet-auto-replace-style';
    var LS_KEY = 'dc_worksheet_auto_replace_on';

    var pollTimer = null;
    var mo = null;
    var lastSig = '';
    var hostEl = null;
    var statusEl = null;
    var toggleInput = null;

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

    function pollMs() {
        var n = Number(getPref('worksheetAutoReplacePollMs', 800));
        if (!Number.isFinite(n)) {
            return 800;
        }
        return Math.min(10000, Math.max(200, Math.floor(n)));
    }

    function readWatchOn() {
        try {
            return localStorage.getItem(LS_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function writeWatchOn(on) {
        try {
            localStorage.setItem(LS_KEY, on ? '1' : '0');
        } catch (e) {}
    }

    /**
     * Pull Tails / Lines / Flights integers from visible text (worksheet summary block).
     * Tuned for labels like "Tails 3", "Tails: 3", "Lines (12)", etc.
     */
    function parseCountsFromText(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }
        var t = text.replace(/\s+/g, ' ');
        function pick(reAfter, reBefore) {
            var m = t.match(reAfter);
            if (m) {
                return parseInt(m[1], 10);
            }
            m = t.match(reBefore);
            return m ? parseInt(m[1], 10) : NaN;
        }
        var tails = pick(/\btails?\b[^0-9]{0,32}(\d+)/i, /(\d+)[^0-9]{0,24}\btails?\b/i);
        var lines = pick(/\blines?\b[^0-9]{0,32}(\d+)/i, /(\d+)[^0-9]{0,24}\blines?\b/i);
        var flights = pick(/\bflights?\b[^0-9]{0,32}(\d+)/i, /(\d+)[^0-9]{0,24}\bflights?\b/i);
        if (!Number.isFinite(tails) || !Number.isFinite(lines) || !Number.isFinite(flights)) {
            return null;
        }
        return { tails: tails, lines: lines, flights: flights };
    }

    function scanCounts() {
        var root =
            document.querySelector('[role="main"]') ||
            document.querySelector('main') ||
            document.body;
        var text = (root && root.innerText) || '';
        return parseCountsFromText(text);
    }

    function fingerprint(c) {
        if (!c) {
            return '';
        }
        return c.tails + '|' + c.lines + '|' + c.flights;
    }

    function findReplaceControl() {
        var i;
        var list = document.querySelectorAll('button,[role="button"],a[href]');
        for (i = 0; i < list.length; i++) {
            var el = list[i];
            var parts = [];
            if (el.getAttribute) {
                if (el.getAttribute('aria-label')) {
                    parts.push(el.getAttribute('aria-label'));
                }
                if (el.getAttribute('title')) {
                    parts.push(el.getAttribute('title'));
                }
            }
            parts.push(el.textContent || '');
            var lab = parts.join(' ').replace(/\s+/g, ' ').trim();
            if (/^replace$/i.test(lab)) {
                return el;
            }
        }
        for (i = 0; i < list.length; i++) {
            var el2 = list[i];
            var txt = (el2.textContent || '').replace(/\s+/g, ' ').trim();
            if (txt.length > 0 && txt.length <= 24 && /^replace$/i.test(txt)) {
                return el2;
            }
        }
        return null;
    }

    function clickReplace(reason) {
        var btn = findReplaceControl();
        if (!btn) {
            setStatus('Replace control not found');
            return false;
        }
        try {
            btn.focus();
        } catch (e) {}
        try {
            btn.click();
        } catch (e1) {
            try {
                btn.dispatchEvent(
                    new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
                );
            } catch (e2) {}
        }
        setStatus('Clicked Replace · ' + (reason || ''));
        return true;
    }

    function setStatus(msg) {
        if (statusEl) {
            statusEl.textContent = msg || '';
        }
    }

    function tick() {
        if (!readWatchOn()) {
            return;
        }
        var c = scanCounts();
        var sig = fingerprint(c);
        if (!sig) {
            setStatus('Watching… (waiting for Tails/Lines/Flights text)');
            return;
        }
        if (!lastSig) {
            lastSig = sig;
            setStatus('Watching · ' + sig.replace(/\|/g, ' / '));
            return;
        }
        if (sig !== lastSig) {
            lastSig = sig;
            clickReplace(sig);
        } else {
            setStatus('Watching · ' + sig.replace(/\|/g, ' / '));
        }
    }

    function startPoll() {
        stopPoll();
        pollTimer = setInterval(tick, pollMs());
        tick();
    }

    function stopPoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent =
            '#' +
            HOST_ID +
            '{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;padding:8px 10px;' +
            'background:rgba(30,40,55,0.92);border:1px solid #3d4f66;border-radius:6px;font:12px/1.4 system-ui,sans-serif;color:#e8eef5;max-width:100%;box-sizing:border-box;}' +
            '#' +
            HOST_ID +
            ' label{cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none;}' +
            '#' +
            HOST_ID +
            ' input{accent-color:#5dade2;width:16px;height:16px;}' +
            '#' +
            HOST_ID +
            ' .dc-war-status{font-size:11px;color:#aebccf;min-width:0;flex:1;}' +
            '#' +
            HOST_ID +
            ' .dc-war-title{font-weight:600;color:#5dade2;}';
        document.head.appendChild(st);
    }

    function findToolbarAnchor() {
        var btn = findReplaceControl();
        if (!btn) {
            return null;
        }
        var el = btn;
        var depth = 0;
        while (el && depth < 12) {
            var p = el.parentElement;
            if (!p) {
                break;
            }
            var bs = p.querySelectorAll && p.querySelectorAll('button,[role="button"]');
            if (bs && bs.length >= 2) {
                return p;
            }
            el = p;
            depth++;
        }
        return btn.parentElement || document.body;
    }

    function mountHost() {
        var existing = document.getElementById(HOST_ID);
        var anchor = findToolbarAnchor();
        if (existing) {
            hostEl = existing;
            statusEl = hostEl.querySelector('.dc-war-status');
            toggleInput = hostEl.querySelector('input[type="checkbox"]');
            if (anchor && hostEl.parentNode !== anchor.parentNode) {
                try {
                    if (anchor.nextSibling) {
                        anchor.parentNode.insertBefore(hostEl, anchor.nextSibling);
                    } else {
                        anchor.parentNode.appendChild(hostEl);
                    }
                } catch (e) {}
            }
            return;
        }
        ensureStyle();
        var wrap = document.createElement('div');
        wrap.id = HOST_ID;
        wrap.innerHTML =
            '<span class="dc-war-title">Auto replace</span>' +
            '<label><input type="checkbox" /> Watch Tails / Lines / Flights · click Replace on change</label>' +
            '<span class="dc-war-status"></span>';
        if (anchor) {
            if (anchor.nextSibling) {
                anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
            } else {
                anchor.parentNode.appendChild(wrap);
            }
        } else {
            wrap.style.position = 'fixed';
            wrap.style.right = '12px';
            wrap.style.bottom = '12px';
            wrap.style.zIndex = '99999';
            wrap.style.maxWidth = 'min(420px,calc(100vw - 24px))';
            document.body.appendChild(wrap);
        }
        hostEl = wrap;
        statusEl = wrap.querySelector('.dc-war-status');
        toggleInput = wrap.querySelector('input[type="checkbox"]');
        toggleInput.checked = readWatchOn();
        toggleInput.addEventListener('change', function () {
            writeWatchOn(toggleInput.checked);
            lastSig = '';
            if (toggleInput.checked) {
                startPoll();
            } else {
                stopPoll();
                setStatus('Off');
            }
        });
        if (readWatchOn()) {
            startPoll();
        } else {
            setStatus('Off');
        }
    }

    function tryMount() {
        mountHost();
    }

    function init() {
        tryMount();
        mo = new MutationObserver(function () {
            if (!document.getElementById(HOST_ID)) {
                tryMount();
            }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.__myScriptCleanup = function () {
        stopPoll();
        if (mo) {
            mo.disconnect();
            mo = null;
        }
        try {
            var h = document.getElementById(HOST_ID);
            if (h) {
                h.remove();
            }
        } catch (e) {}
        var st = document.getElementById(STYLE_ID);
        if (st) {
            st.remove();
        }
        hostEl = null;
        statusEl = null;
        toggleInput = null;
        window.__myScriptCleanup = undefined;
    };
})();
