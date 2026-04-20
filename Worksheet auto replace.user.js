// ==UserScript==
// @name         Worksheet auto replace
// @namespace    Wolf 2.0
// @version      1.1.0
// @description  Worksheet: watch Tails/Lines/Flights counts (line-scoped parse), click Replace on change; optional interval Replace. Toggle under toolbar.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        none
// @donkeycode-pref {"worksheetAutoReplacePollMs":{"type":"number","group":"Auto replace","label":"Check interval (ms)","description":"How often to re-read counts from the page while the watch is on.","default":800,"min":200,"max":10000,"step":100},"worksheetAutoReplaceIntervalSec":{"type":"number","group":"Auto replace","label":"Interval Replace (seconds)","description":"Default seconds for “Replace every…” when interval mode is on (min 5).","default":30,"min":5,"max":3600,"step":1}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20auto%20replace.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20auto%20replace.user.js
// ==/UserScript==

(function () {
    'use strict';

    var HOST_ID = 'dc-worksheet-auto-replace-host';
    var STYLE_ID = 'dc-worksheet-auto-replace-style';
    var LS_KEY = 'dc_worksheet_auto_replace_on';
    var LS_INTERVAL_ON = 'dc_worksheet_auto_replace_interval_on';
    var LS_INTERVAL_SEC = 'dc_worksheet_auto_replace_interval_sec';

    var pollTimer = null;
    var intervalTimer = null;
    var relocateRetryTimer = null;
    var mo = null;
    var relocateRaf = 0;
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

    function readIntervalOn() {
        try {
            return localStorage.getItem(LS_INTERVAL_ON) === '1';
        } catch (e) {
            return false;
        }
    }

    function writeIntervalOn(on) {
        try {
            localStorage.setItem(LS_INTERVAL_ON, on ? '1' : '0');
        } catch (e) {}
    }

    function intervalSecFromPref() {
        var n = Number(getPref('worksheetAutoReplaceIntervalSec', 30));
        if (!Number.isFinite(n)) {
            return 30;
        }
        return Math.min(3600, Math.max(5, Math.floor(n)));
    }

    function intervalSecEffective() {
        try {
            var raw = localStorage.getItem(LS_INTERVAL_SEC);
            if (raw !== null && raw !== '') {
                var n = parseInt(raw, 10);
                if (Number.isFinite(n)) {
                    return Math.min(3600, Math.max(5, n));
                }
            }
        } catch (e) {}
        return intervalSecFromPref();
    }

    function writeIntervalSec(n) {
        try {
            localStorage.setItem(LS_INTERVAL_SEC, String(n));
        } catch (e) {}
    }

    /**
     * First number after the keyword on the same line (avoids picking unrelated digits from the rest of the page).
     */
    function firstIntAfterKeyword(line, wordRe) {
        var m = line.match(wordRe);
        return m ? parseInt(m[1], 10) : NaN;
    }

    /**
     * Pull Tails / Lines / Flights integers from visible text — scan **line by line** so values match the UI labels.
     */
    function parseCountsFromText(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }
        var rawLines = text.split(/\r?\n/);
        var tails = NaN;
        var linesCount = NaN;
        var flights = NaN;
        var li;
        for (li = 0; li < rawLines.length; li++) {
            var line = rawLines[li].replace(/\s+/g, ' ').trim();
            if (!line) {
                continue;
            }
            if (Number.isFinite(tails) && Number.isFinite(linesCount) && Number.isFinite(flights)) {
                break;
            }
            if (!Number.isFinite(tails) && /\btails\b/i.test(line) && !/\bairlines?\b/i.test(line)) {
                var tt = firstIntAfterKeyword(line, /\btails\b[^0-9]{0,48}(\d+)/i);
                if (Number.isFinite(tt)) {
                    tails = tt;
                }
            }
            if (!Number.isFinite(linesCount) && /\blines\b/i.test(line)) {
                var ll = firstIntAfterKeyword(line, /\blines\b[^0-9]{0,48}(\d+)/i);
                if (Number.isFinite(ll)) {
                    linesCount = ll;
                }
            }
            if (!Number.isFinite(flights) && /\bflights?\b/i.test(line)) {
                var ff = firstIntAfterKeyword(line, /\bflights?\b[^0-9]{0,48}(\d+)/i);
                if (Number.isFinite(ff)) {
                    flights = ff;
                }
            }
        }
        if (!Number.isFinite(tails) || !Number.isFinite(linesCount) || !Number.isFinite(flights)) {
            return null;
        }
        return { tails: tails, lines: linesCount, flights: flights };
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

    /** Human-readable counts for the status line (confirms which metrics are watched). */
    function formatCountsLabel(c) {
        if (!c) {
            return '';
        }
        return 'Tails ' + c.tails + ' · Lines ' + c.lines + ' · Flights ' + c.flights;
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
            setStatus('Replace not found · ' + (reason || ''));
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
        var label = formatCountsLabel(c);
        if (!lastSig) {
            lastSig = sig;
            setStatus('Watching · ' + label);
            return;
        }
        if (sig !== lastSig) {
            lastSig = sig;
            clickReplace('counts changed · ' + label);
        } else {
            setStatus('Watching · ' + label);
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

    function stopIntervalReplace() {
        if (intervalTimer) {
            clearInterval(intervalTimer);
            intervalTimer = null;
        }
    }

    function startIntervalReplace() {
        stopIntervalReplace();
        if (!readIntervalOn()) {
            return;
        }
        var sec = intervalSecEffective();
        intervalTimer = setInterval(function () {
            if (!readIntervalOn()) {
                stopIntervalReplace();
                return;
            }
            var s = intervalSecEffective();
            clickReplace('interval · every ' + s + 's');
        }, sec * 1000);
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
            ' .dc-war-title{font-weight:600;color:#5dade2;}' +
            '#' +
            HOST_ID +
            ' .dc-war-interval{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;margin-top:4px;padding-top:8px;border-top:1px solid #3d4f66;}' +
            '#' +
            HOST_ID +
            ' .dc-war-interval input[type="number"]{width:64px;padding:3px 6px;border-radius:4px;border:1px solid #555;background:#1a1f28;color:#e8eef5;font-size:12px;}';
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

    function clearFloatingFallbackStyles(host) {
        if (!host) {
            return;
        }
        if (host.getAttribute('data-dc-war-fallback') === '1') {
            host.style.position = '';
            host.style.right = '';
            host.style.bottom = '';
            host.style.zIndex = '';
            host.style.maxWidth = '';
            host.removeAttribute('data-dc-war-fallback');
        }
    }

    /**
     * Move host under the toolbar after Replace appears (fixes fixed bottom-right stuck after refresh).
     */
    function relocateHost() {
        var host = document.getElementById(HOST_ID);
        if (!host) {
            return;
        }
        var anchor = findToolbarAnchor();
        if (!anchor || !anchor.parentNode) {
            return;
        }
        var parent = anchor.parentNode;
        clearFloatingFallbackStyles(host);
        try {
            if (anchor.nextSibling !== host) {
                parent.insertBefore(host, anchor.nextSibling);
            }
        } catch (e) {}
    }

    function scheduleRelocateHost() {
        if (relocateRaf) {
            cancelAnimationFrame(relocateRaf);
        }
        relocateRaf = requestAnimationFrame(function () {
            relocateRaf = 0;
            relocateHost();
        });
    }

    function startRelocateRetries() {
        if (relocateRetryTimer) {
            clearInterval(relocateRetryTimer);
            relocateRetryTimer = null;
        }
        var n = 0;
        var max = 60;
        relocateRetryTimer = setInterval(function () {
            n++;
            relocateHost();
            var h = document.getElementById(HOST_ID);
            var stillFloating = h && h.getAttribute('data-dc-war-fallback') === '1';
            if (!stillFloating || n >= max) {
                clearInterval(relocateRetryTimer);
                relocateRetryTimer = null;
            }
        }, 250);
    }

    function mountHost() {
        var existing = document.getElementById(HOST_ID);
        var anchor = findToolbarAnchor();
        if (existing) {
            hostEl = existing;
            statusEl = hostEl.querySelector('.dc-war-status');
            toggleInput = hostEl.querySelector('input[data-dc-watch-toggle]');
            var secIn = hostEl.querySelector('input[data-dc-interval-sec]');
            if (secIn) {
                secIn.value = String(intervalSecEffective());
            }
            relocateHost();
            return;
        }
        ensureStyle();
        var wrap = document.createElement('div');
        wrap.id = HOST_ID;
        wrap.innerHTML =
            '<span class="dc-war-title">Auto replace</span>' +
            '<label><input type="checkbox" data-dc-watch-toggle /> Watch Tails / Lines / Flights · click Replace when any count changes</label>' +
            '<span class="dc-war-status"></span>' +
            '<div class="dc-war-interval">' +
            '<label><input type="checkbox" data-dc-interval-toggle /> Replace every</label>' +
            '<input type="number" min="5" max="3600" step="1" data-dc-interval-sec title="Seconds between Replace clicks" />' +
            '<span>sec</span><span style="font-size:10px;opacity:0.85;">(uses Auto replace pref default)</span>' +
            '</div>';
        if (anchor) {
            if (anchor.nextSibling) {
                anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
            } else {
                anchor.parentNode.appendChild(wrap);
            }
        } else {
            wrap.setAttribute('data-dc-war-fallback', '1');
            wrap.style.position = 'fixed';
            wrap.style.right = '12px';
            wrap.style.bottom = '12px';
            wrap.style.zIndex = '99999';
            wrap.style.maxWidth = 'min(420px,calc(100vw - 24px))';
            document.body.appendChild(wrap);
        }
        hostEl = wrap;
        statusEl = wrap.querySelector('.dc-war-status');
        toggleInput = wrap.querySelector('input[data-dc-watch-toggle]');
        var intervalToggle = wrap.querySelector('input[data-dc-interval-toggle]');
        var intervalSecInput = wrap.querySelector('input[data-dc-interval-sec]');
        if (intervalSecInput) {
            intervalSecInput.value = String(intervalSecEffective());
            intervalSecInput.addEventListener('change', function () {
                var v = parseInt(intervalSecInput.value, 10);
                if (!Number.isFinite(v)) {
                    intervalSecInput.value = String(intervalSecEffective());
                    return;
                }
                v = Math.min(3600, Math.max(5, v));
                intervalSecInput.value = String(v);
                writeIntervalSec(v);
                if (readIntervalOn()) {
                    startIntervalReplace();
                }
            });
        }
        if (intervalToggle) {
            intervalToggle.checked = readIntervalOn();
            intervalToggle.addEventListener('change', function () {
                writeIntervalOn(intervalToggle.checked);
                if (intervalToggle.checked) {
                    startIntervalReplace();
                } else {
                    stopIntervalReplace();
                    if (!readWatchOn()) {
                        setStatus('Off');
                    }
                }
            });
        }
        toggleInput.checked = readWatchOn();
        toggleInput.addEventListener('change', function () {
            writeWatchOn(toggleInput.checked);
            lastSig = '';
            if (toggleInput.checked) {
                startPoll();
            } else {
                stopPoll();
                if (!readIntervalOn()) {
                    setStatus('Off');
                }
            }
        });
        if (readWatchOn()) {
            startPoll();
        } else if (!readIntervalOn()) {
            setStatus('Off');
        }
        if (readIntervalOn()) {
            startIntervalReplace();
        }
        startRelocateRetries();
    }

    function tryMount() {
        mountHost();
    }

    function init() {
        tryMount();
        mo = new MutationObserver(function () {
            if (!document.getElementById(HOST_ID)) {
                tryMount();
            } else {
                scheduleRelocateHost();
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
        stopIntervalReplace();
        if (relocateRetryTimer) {
            clearInterval(relocateRetryTimer);
            relocateRetryTimer = null;
        }
        if (relocateRaf) {
            cancelAnimationFrame(relocateRaf);
            relocateRaf = 0;
        }
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
