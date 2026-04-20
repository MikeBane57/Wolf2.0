// ==UserScript==
// @name         Worksheet auto replace
// @namespace    Wolf 2.0
// @version      1.3.0
// @description  Worksheet: watch Tails/Lines/Flights (pick metrics) from smart-widget stats; click Replace, Append, or Remove on change or interval.
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
    var LS_ACTION_WATCH = 'dc_worksheet_auto_replace_action_watch';
    var LS_ACTION_INTERVAL = 'dc_worksheet_auto_replace_action_interval';
    var LS_METRICS = 'dc_worksheet_auto_replace_metrics';

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

    function readActionWatch() {
        try {
            var v = localStorage.getItem(LS_ACTION_WATCH);
            if (v === 'append' || v === 'remove' || v === 'replace') {
                return v;
            }
        } catch (e) {}
        return 'replace';
    }

    function writeActionWatch(a) {
        try {
            localStorage.setItem(LS_ACTION_WATCH, a === 'append' || a === 'remove' ? a : 'replace');
        } catch (e) {}
    }

    function readActionInterval() {
        try {
            var v = localStorage.getItem(LS_ACTION_INTERVAL);
            if (v === 'append' || v === 'remove' || v === 'replace') {
                return v;
            }
        } catch (e) {}
        return 'replace';
    }

    function writeActionInterval(a) {
        try {
            localStorage.setItem(LS_ACTION_INTERVAL, a === 'append' || a === 'remove' ? a : 'replace');
        } catch (e) {}
    }

    function readMetricsSet() {
        try {
            var raw = localStorage.getItem(LS_METRICS);
            if (!raw || raw === '') {
                return { tails: true, lines: true, flights: true };
            }
            var parts = String(raw)
                .split(',')
                .map(function (s) {
                    return s.trim().toLowerCase();
                });
            var o = {
                tails: parts.indexOf('tails') >= 0,
                lines: parts.indexOf('lines') >= 0,
                flights: parts.indexOf('flights') >= 0
            };
            if (!o.tails && !o.lines && !o.flights) {
                return { tails: true, lines: true, flights: true };
            }
            return o;
        } catch (e) {}
        return { tails: true, lines: true, flights: true };
    }

    function writeMetricsSet(o) {
        var arr = [];
        if (o.tails) {
            arr.push('tails');
        }
        if (o.lines) {
            arr.push('lines');
        }
        if (o.flights) {
            arr.push('flights');
        }
        if (!arr.length) {
            arr = ['tails', 'lines', 'flights'];
        }
        try {
            localStorage.setItem(LS_METRICS, arr.join(','));
        } catch (e) {}
    }

    /**
     * Number paired with a label on one line — supports `Tails 289`, `289 Tails`, `Tails: 289`, etc.
     */
    function intBesideLabel(line, labelPattern) {
        var s = line.replace(/\s+/g, ' ').trim();
        if (!s) {
            return NaN;
        }
        var m = s.match(new RegExp(labelPattern + '[^0-9]{0,32}(\\d+)', 'i'));
        if (m) {
            return parseInt(m[1], 10);
        }
        m = s.match(new RegExp('(\\d+)[^0-9]{0,32}' + labelPattern + '(?:\\b|$)', 'i'));
        if (m) {
            return parseInt(m[1], 10);
        }
        return NaN;
    }

    function extractTailsFromLine(line) {
        if (/\bair\s*lines?\b/i.test(line)) {
            return NaN;
        }
        var v = intBesideLabel(line, '\\btails?\\b');
        if (Number.isFinite(v)) {
            return v;
        }
        return intBesideLabel(line, '\\btail\\b');
    }

    function extractLinesFromLine(line) {
        var v = intBesideLabel(line, '\\blines\\b');
        if (Number.isFinite(v)) {
            return v;
        }
        return intBesideLabel(line, '\\bline\\b');
    }

    function extractFlightsFromLine(line) {
        var v = intBesideLabel(line, '\\bflights?\\b');
        if (Number.isFinite(v)) {
            return v;
        }
        return NaN;
    }

    /**
     * Pull Tails / Lines / Flights from visible text — line by line; number may appear before or after the label.
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
            var line = rawLines[li];
            if (!Number.isFinite(tails)) {
                var tt = extractTailsFromLine(line);
                if (Number.isFinite(tt)) {
                    tails = tt;
                }
            }
            if (!Number.isFinite(linesCount)) {
                var ll = extractLinesFromLine(line);
                if (Number.isFinite(ll)) {
                    linesCount = ll;
                }
            }
            if (!Number.isFinite(flights)) {
                var ff = extractFlightsFromLine(line);
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

    function parseIntFromValueEl(el) {
        if (!el) {
            return NaN;
        }
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        var m = t.match(/(\d+)/);
        return m ? parseInt(m[1], 10) : NaN;
    }

    /**
     * Worksheet summary: #smart-widget → .ui.small.inverted.statistics (Semantic UI) → three columns,
     * each `> div` has `.value` (Tails, Lines, Flights in order). Matches DevTools paths user provided.
     */
    function scanCountsFromStatisticsWidget() {
        var sw = document.getElementById('smart-widget');
        if (!sw) {
            return null;
        }
        var stats =
            sw.querySelector('.ui.small.inverted.statistics') ||
            sw.querySelector('.ui.inverted.statistics') ||
            sw.querySelector('.ui.statistics');
        if (!stats) {
            return null;
        }
        var valueEls = [];
        var ch = stats.children;
        var i;
        for (i = 0; i < ch.length; i++) {
            var row = ch[i];
            if (!row || !row.querySelector) {
                continue;
            }
            var ve = row.querySelector('.value');
            if (ve) {
                valueEls.push(ve);
            }
        }
        if (valueEls.length < 3) {
            var all = stats.querySelectorAll('.value');
            if (all.length >= 3) {
                valueEls = [all[0], all[1], all[2]];
            }
        }
        if (valueEls.length < 3) {
            return null;
        }
        var tails = parseIntFromValueEl(valueEls[0]);
        var linesCount = parseIntFromValueEl(valueEls[1]);
        var flights = parseIntFromValueEl(valueEls[2]);
        if (!Number.isFinite(tails) || !Number.isFinite(linesCount) || !Number.isFinite(flights)) {
            return null;
        }
        return { tails: tails, lines: linesCount, flights: flights, source: 'widget' };
    }

    function scanCounts() {
        var fromWidget = scanCountsFromStatisticsWidget();
        if (fromWidget) {
            return fromWidget;
        }
        var root =
            document.querySelector('[role="main"]') ||
            document.querySelector('main') ||
            document.body;
        var text = (root && root.innerText) || '';
        var parsed = parseCountsFromText(text);
        if (parsed) {
            parsed.source = 'text';
        }
        return parsed;
    }

    function fingerprint(c) {
        if (!c) {
            return '';
        }
        return c.tails + '|' + c.lines + '|' + c.flights;
    }

    function fingerprintForMetrics(c, m) {
        if (!c || !m) {
            return '';
        }
        var parts = [];
        if (m.tails) {
            parts.push('t:' + c.tails);
        }
        if (m.lines) {
            parts.push('l:' + c.lines);
        }
        if (m.flights) {
            parts.push('f:' + c.flights);
        }
        return parts.join('|');
    }

    /** Human-readable counts for the status line (confirms which metrics are watched). */
    function formatCountsLabel(c) {
        if (!c) {
            return '';
        }
        var base = 'Tails ' + c.tails + ' · Lines ' + c.lines + ' · Flights ' + c.flights;
        if (c.source === 'widget') {
            return base + ' (worksheet stats)';
        }
        if (c.source === 'text') {
            return base + ' (text scan)';
        }
        return base;
    }

    function labelForToolbarAction(action) {
        if (action === 'append') {
            return 'Append';
        }
        if (action === 'remove') {
            return 'Remove';
        }
        return 'Replace';
    }

    function findToolbarButtonByLabel(exactName) {
        var want = String(exactName || '').toLowerCase();
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
            if (new RegExp('^' + want + '$', 'i').test(lab)) {
                return el;
            }
        }
        for (i = 0; i < list.length; i++) {
            var el2 = list[i];
            var txt = (el2.textContent || '').replace(/\s+/g, ' ').trim();
            if (txt.length > 0 && txt.length <= 32 && new RegExp('^' + want + '$', 'i').test(txt)) {
                return el2;
            }
        }
        return null;
    }

    function findToolbarAnchorForAnyAction() {
        var order = ['replace', 'append', 'remove'];
        var i;
        for (i = 0; i < order.length; i++) {
            var b = findToolbarButtonByLabel(order[i]);
            if (b) {
                return b;
            }
        }
        return null;
    }

    function clickToolbarAction(action, reason) {
        var name = labelForToolbarAction(action).toLowerCase();
        var btn = findToolbarButtonByLabel(name);
        if (!btn) {
            setStatus(labelForToolbarAction(action) + ' not found · ' + (reason || ''));
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
        setStatus('Clicked ' + labelForToolbarAction(action) + ' · ' + (reason || ''));
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
        var m = readMetricsSet();
        var sig = fingerprintForMetrics(c, m);
        if (!sig) {
            setStatus('Watching… (waiting for worksheet stats / Tails·Lines·Flights)');
            return;
        }
        var label = formatCountsLabel(c);
        var act = readActionWatch();
        if (!lastSig) {
            lastSig = sig;
            setStatus('Watching · ' + label + ' · ' + labelForToolbarAction(act));
            return;
        }
        if (sig !== lastSig) {
            lastSig = sig;
            clickToolbarAction(act, 'counts changed · ' + label);
        } else {
            setStatus('Watching · ' + label + ' · ' + labelForToolbarAction(act));
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
            var ia = readActionInterval();
            clickToolbarAction(ia, 'interval · every ' + s + 's');
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
            ' .dc-war-interval input[type="number"]{width:64px;padding:3px 6px;border-radius:4px;border:1px solid #555;background:#1a1f28;color:#e8eef5;font-size:12px;}' +
            '#' +
            HOST_ID +
            ' .dc-war-metrics{display:flex;flex-wrap:wrap;align-items:center;gap:10px;width:100%;margin-top:6px;font-size:11px;color:#aebccf;}' +
            '#' +
            HOST_ID +
            ' .dc-war-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;margin-top:6px;}' +
            '#' +
            HOST_ID +
            ' .dc-war-actions select{padding:4px 8px;border-radius:4px;border:1px solid #555;background:#1a1f28;color:#e8eef5;font-size:12px;max-width:100%;}' +
            '#' +
            HOST_ID +
            '[data-dc-war-placed="0"]{visibility:hidden!important;opacity:0!important;pointer-events:none!important;}';
        document.head.appendChild(st);
    }

    function setHostPlaced(host, placed) {
        if (!host) {
            return;
        }
        host.setAttribute('data-dc-war-placed', placed ? '1' : '0');
    }

    function findToolbarAnchor() {
        var btn = findToolbarAnchorForAnyAction();
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
            setHostPlaced(host, true);
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
            setHostPlaced(host, true);
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

    var HOST_HTML =
        '<span class="dc-war-title">Worksheet filter actions</span>' +
        '<div class="dc-war-metrics">' +
        '<span>Watch metrics:</span>' +
        '<label><input type="checkbox" data-dc-metric="tails" /> Tails</label>' +
        '<label><input type="checkbox" data-dc-metric="lines" /> Lines</label>' +
        '<label><input type="checkbox" data-dc-metric="flights" /> Flights</label>' +
        '</div>' +
        '<label><input type="checkbox" data-dc-watch-toggle /> When selected counts change, click:</label>' +
        '<div class="dc-war-actions">' +
        '<select data-dc-action-watch title="Button to click when counts change">' +
        '<option value="replace">Replace</option><option value="append">Append</option><option value="remove">Remove</option>' +
        '</select>' +
        '</div>' +
        '<span class="dc-war-status"></span>' +
        '<div class="dc-war-interval">' +
        '<label><input type="checkbox" data-dc-interval-toggle /> Also click every</label>' +
        '<input type="number" min="5" max="3600" step="1" data-dc-interval-sec title="Seconds between clicks" />' +
        '<span>sec</span>' +
        '<select data-dc-action-interval title="Button for interval clicks">' +
        '<option value="replace">Replace</option><option value="append">Append</option><option value="remove">Remove</option>' +
        '</select>' +
        '</div>';

    function applyMetricsToCheckboxes(host) {
        var m = readMetricsSet();
        var boxes = host.querySelectorAll('input[data-dc-metric]');
        var i;
        for (i = 0; i < boxes.length; i++) {
            var name = (boxes[i].getAttribute('data-dc-metric') || '').toLowerCase();
            if (name === 'tails') {
                boxes[i].checked = !!m.tails;
            } else if (name === 'lines') {
                boxes[i].checked = !!m.lines;
            } else if (name === 'flights') {
                boxes[i].checked = !!m.flights;
            }
        }
    }

    function readMetricsFromCheckboxes(host) {
        var o = { tails: false, lines: false, flights: false };
        var boxes = host.querySelectorAll('input[data-dc-metric]');
        var i;
        for (i = 0; i < boxes.length; i++) {
            var name = (boxes[i].getAttribute('data-dc-metric') || '').toLowerCase();
            if (boxes[i].checked) {
                if (name === 'tails') {
                    o.tails = true;
                }
                if (name === 'lines') {
                    o.lines = true;
                }
                if (name === 'flights') {
                    o.flights = true;
                }
            }
        }
        return o;
    }

    function bindHostControls(wrap) {
        if (wrap.getAttribute('data-dc-war-bound') === '1') {
            applyMetricsToCheckboxes(wrap);
            var sw = wrap.querySelector('select[data-dc-action-watch]');
            var si = wrap.querySelector('select[data-dc-action-interval]');
            var sec = wrap.querySelector('input[data-dc-interval-sec]');
            var it = wrap.querySelector('input[data-dc-interval-toggle]');
            var wt = wrap.querySelector('input[data-dc-watch-toggle]');
            if (sw) {
                sw.value = readActionWatch();
            }
            if (si) {
                si.value = readActionInterval();
            }
            if (sec) {
                sec.value = String(intervalSecEffective());
            }
            if (it) {
                it.checked = readIntervalOn();
            }
            if (wt) {
                wt.checked = readWatchOn();
            }
            hostEl = wrap;
            statusEl = wrap.querySelector('.dc-war-status');
            toggleInput = wt;
            return;
        }
        wrap.setAttribute('data-dc-war-bound', '1');
        hostEl = wrap;
        statusEl = wrap.querySelector('.dc-war-status');
        toggleInput = wrap.querySelector('input[data-dc-watch-toggle]');
        var selWatch = wrap.querySelector('select[data-dc-action-watch]');
        var selInterval = wrap.querySelector('select[data-dc-action-interval]');
        var intervalToggle = wrap.querySelector('input[data-dc-interval-toggle]');
        var intervalSecInput = wrap.querySelector('input[data-dc-interval-sec]');
        applyMetricsToCheckboxes(wrap);
        if (selWatch) {
            selWatch.value = readActionWatch();
        }
        if (selInterval) {
            selInterval.value = readActionInterval();
        }
        if (intervalSecInput) {
            intervalSecInput.value = String(intervalSecEffective());
        }
        if (intervalToggle) {
            intervalToggle.checked = readIntervalOn();
        }
        if (toggleInput) {
            toggleInput.checked = readWatchOn();
        }
        var metricBoxes = wrap.querySelectorAll('input[data-dc-metric]');
        var mi;
        for (mi = 0; mi < metricBoxes.length; mi++) {
            metricBoxes[mi].addEventListener('change', function () {
                writeMetricsSet(readMetricsFromCheckboxes(wrap));
                lastSig = '';
                if (readWatchOn()) {
                    tick();
                }
            });
        }
        if (selWatch) {
            selWatch.addEventListener('change', function () {
                writeActionWatch(selWatch.value);
                lastSig = '';
                if (readWatchOn()) {
                    tick();
                }
            });
        }
        if (selInterval) {
            selInterval.addEventListener('change', function () {
                writeActionInterval(selInterval.value);
                if (readIntervalOn()) {
                    startIntervalReplace();
                }
            });
        }
        if (intervalSecInput) {
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
        if (toggleInput) {
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
        }
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
                if (stillFloating && n >= max && h) {
                    setHostPlaced(h, true);
                }
                clearInterval(relocateRetryTimer);
                relocateRetryTimer = null;
            }
        }, 250);
    }

    function mountHost() {
        var existing = document.getElementById(HOST_ID);
        var anchor = findToolbarAnchor();
        if (existing) {
            if (!existing.querySelector('select[data-dc-action-watch]')) {
                existing.innerHTML = HOST_HTML;
                existing.removeAttribute('data-dc-war-bound');
            }
            bindHostControls(existing);
            relocateHost();
            if (hostEl.getAttribute('data-dc-war-placed') !== '1') {
                setHostPlaced(hostEl, findToolbarAnchor() !== null);
            }
            return;
        }
        ensureStyle();
        var wrap = document.createElement('div');
        wrap.id = HOST_ID;
        wrap.innerHTML = HOST_HTML;
        if (anchor) {
            if (anchor.nextSibling) {
                anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
            } else {
                anchor.parentNode.appendChild(wrap);
            }
            setHostPlaced(wrap, true);
        } else {
            wrap.setAttribute('data-dc-war-fallback', '1');
            wrap.style.position = 'fixed';
            wrap.style.right = '12px';
            wrap.style.bottom = '12px';
            wrap.style.zIndex = '99999';
            wrap.style.maxWidth = 'min(420px,calc(100vw - 24px))';
            setHostPlaced(wrap, false);
            document.body.appendChild(wrap);
        }
        bindHostControls(wrap);
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
