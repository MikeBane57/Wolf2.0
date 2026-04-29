// ==UserScript==
// @name         Worksheet auto filter actions
// @namespace    Wolf 2.0
// @version      1.3.9
// @description  Worksheet: auto filter per tab; watch row / divider / interval row; default actions pick a button.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        none
// @donkeycode-pref {"worksheetAutoReplacePollMs":{"type":"number","group":"Auto filter actions","label":"Check interval (ms)","description":"How often to re-read counts from the page while the watch is on.","default":800,"min":200,"max":10000,"step":100},"worksheetAutoReplaceIntervalSec":{"type":"number","group":"Auto filter actions","label":"Interval (seconds)","description":"Default seconds for interval clicks when interval mode is on (min 5).","default":30,"min":5,"max":3600,"step":1}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20auto%20filter%20actions.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20auto%20filter%20actions.user.js
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
    var LS_COLLAPSED = 'dc_worksheet_auto_replace_collapsed';
    var LS_OP_TIME_AUTO = 'dc_worksheet_auto_op_time_24h';
    /**
     * Per-worksheet-tab state. Keys = session tab id (see dcPaxLateWsTabId); values = settings object.
     * Replaces the flat localStorage keys above (migrated once from legacy on first read).
     */
    var LS_BY_WORKSHEET_TAB = 'dc_worksheet_auto_replace_by_tab_v1';
    var SS_WORKSHEET_TAB_ID = 'dcPaxLateWsTabId';

    var cachedWorksheetTabId = null;

    var pollTimer = null;
    var intervalTimer = null;
    var relocateRetryTimer = null;
    var mo = null;
    var relocateRaf = 0;
    var lastSig = '';
    var hostEl = null;
    var toggleInput = null;
    var opTimeTid = null;

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

    function getOrCreateWorksheetTabId() {
        if (cachedWorksheetTabId) {
            return cachedWorksheetTabId;
        }
        try {
            var ex = sessionStorage.getItem(SS_WORKSHEET_TAB_ID);
            if (ex) {
                cachedWorksheetTabId = ex;
                return ex;
            }
        } catch (e) {}
        cachedWorksheetTabId = 'ws' + String(Date.now()) + '-' + String(Math.random()).slice(2, 10);
        try {
            sessionStorage.setItem(SS_WORKSHEET_TAB_ID, cachedWorksheetTabId);
        } catch (e) {}
        return cachedWorksheetTabId;
    }

    function readAllByTab() {
        try {
            var raw = localStorage.getItem(LS_BY_WORKSHEET_TAB);
            if (raw) {
                var o = JSON.parse(raw);
                return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
            }
        } catch (e) {}
        return {};
    }

    function intervalSecFromPref() {
        var n = Number(getPref('worksheetAutoReplaceIntervalSec', 30));
        if (!Number.isFinite(n)) {
            return 30;
        }
        return Math.min(3600, Math.max(5, Math.floor(n)));
    }

    function defaultTabState() {
        return {
            watchOn: false,
            intervalOn: false,
            intervalSec: intervalSecFromPref(),
            actionWatch: '',
            actionInterval: '',
            metrics: { tails: true, lines: true, flights: true },
            collapsed: false,
            opTimeAuto: false
        };
    }

    var LS_LEGACY_MIGRATED = 'dc_worksheet_auto_replace_legacy_to_tab_v1';

    function hasLegacyLocalStorageKeys() {
        try {
            if (localStorage.getItem(LS_KEY) != null) {
                return true;
            }
            if (localStorage.getItem(LS_INTERVAL_ON) != null) {
                return true;
            }
            if (localStorage.getItem(LS_INTERVAL_SEC) != null) {
                return true;
            }
            if (localStorage.getItem(LS_ACTION_WATCH) != null) {
                return true;
            }
            if (localStorage.getItem(LS_ACTION_INTERVAL) != null) {
                return true;
            }
            if (localStorage.getItem(LS_METRICS) != null) {
                return true;
            }
            if (localStorage.getItem(LS_COLLAPSED) != null) {
                return true;
            }
            if (localStorage.getItem(LS_OP_TIME_AUTO) != null) {
                return true;
            }
        } catch (e) {}
        return false;
    }

    function clearLegacyLocalStorageKeys() {
        var keys = [
            LS_KEY,
            LS_INTERVAL_ON,
            LS_INTERVAL_SEC,
            LS_ACTION_WATCH,
            LS_ACTION_INTERVAL,
            LS_METRICS,
            LS_COLLAPSED,
            LS_OP_TIME_AUTO
        ];
        var i;
        for (i = 0; i < keys.length; i++) {
            try {
                localStorage.removeItem(keys[i]);
            } catch (e) {}
        }
    }

    function buildStateFromLegacyKeys() {
        var s = defaultTabState();
        try {
            if (localStorage.getItem(LS_KEY) === '1') {
                s.watchOn = true;
            }
        } catch (e) {}
        try {
            if (localStorage.getItem(LS_INTERVAL_ON) === '1') {
                s.intervalOn = true;
            }
        } catch (e) {}
        try {
            var isec = localStorage.getItem(LS_INTERVAL_SEC);
            if (isec != null && isec !== '') {
                var n = parseInt(isec, 10);
                if (Number.isFinite(n)) {
                    s.intervalSec = Math.min(3600, Math.max(5, n));
                }
            }
        } catch (e) {}
        try {
            var aw = localStorage.getItem(LS_ACTION_WATCH);
            if (aw === 'append' || aw === 'remove') {
                s.actionWatch = aw;
            }
        } catch (e) {}
        try {
            var ai = localStorage.getItem(LS_ACTION_INTERVAL);
            if (ai === 'append' || ai === 'remove') {
                s.actionInterval = ai;
            }
        } catch (e) {}
        try {
            var rawM = localStorage.getItem(LS_METRICS);
            if (rawM) {
                var parts = String(rawM)
                    .split(',')
                    .map(function (x) {
                        return x.trim().toLowerCase();
                    });
                s.metrics = {
                    tails: parts.indexOf('tails') >= 0,
                    lines: parts.indexOf('lines') >= 0,
                    flights: parts.indexOf('flights') >= 0
                };
                if (!s.metrics.tails && !s.metrics.lines && !s.metrics.flights) {
                    s.metrics = { tails: true, lines: true, flights: true };
                }
            }
        } catch (e) {}
        try {
            if (localStorage.getItem(LS_COLLAPSED) === '1') {
                s.collapsed = true;
            }
        } catch (e) {}
        try {
            if (localStorage.getItem(LS_OP_TIME_AUTO) === '1') {
                s.opTimeAuto = true;
            }
        } catch (e) {}
        return s;
    }

    function migrateLegacyToPerTab() {
        try {
            if (localStorage.getItem(LS_LEGACY_MIGRATED) === '1' || !hasLegacyLocalStorageKeys()) {
                return;
            }
        } catch (e) {
            return;
        }
        var all = readAllByTab();
        var tid = getOrCreateWorksheetTabId();
        if (!all[tid]) {
            all[tid] = buildStateFromLegacyKeys();
            try {
                localStorage.setItem(LS_BY_WORKSHEET_TAB, JSON.stringify(all));
            } catch (e) {}
        }
        clearLegacyLocalStorageKeys();
        try {
            localStorage.setItem(LS_LEGACY_MIGRATED, '1');
        } catch (e) {}
    }

    function readTabState() {
        migrateLegacyToPerTab();
        var tid = getOrCreateWorksheetTabId();
        var all = readAllByTab();
        var s = all[tid];
        if (s && typeof s === 'object') {
            var o = defaultTabState();
            o.watchOn = !!s.watchOn;
            o.intervalOn = !!s.intervalOn;
            var nsec = Number(s.intervalSec);
            o.intervalSec = Number.isFinite(nsec) ? Math.min(3600, Math.max(5, Math.floor(nsec))) : intervalSecFromPref();
            o.actionWatch =
                s.actionWatch === 'append' ||
                s.actionWatch === 'remove' ||
                s.actionWatch === 'replace' ||
                s.actionWatch === ''
                    ? s.actionWatch
                    : '';
            o.actionInterval =
                s.actionInterval === 'append' ||
                s.actionInterval === 'remove' ||
                s.actionInterval === 'replace' ||
                s.actionInterval === ''
                    ? s.actionInterval
                    : '';
            o.metrics = {
                tails: !!(s.metrics && s.metrics.tails),
                lines: !!(s.metrics && s.metrics.lines),
                flights: !!(s.metrics && s.metrics.flights)
            };
            if (!o.metrics.tails && !o.metrics.lines && !o.metrics.flights) {
                o.metrics = { tails: true, lines: true, flights: true };
            }
            o.collapsed = !!s.collapsed;
            o.opTimeAuto = !!s.opTimeAuto;
            return o;
        }
        return defaultTabState();
    }

    function writeTabState(next) {
        var tid = getOrCreateWorksheetTabId();
        var all = readAllByTab();
        all[tid] = next;
        try {
            localStorage.setItem(LS_BY_WORKSHEET_TAB, JSON.stringify(all));
        } catch (e) {}
    }

    function readWatchOn() {
        return readTabState().watchOn;
    }

    function writeWatchOn(on) {
        var s = readTabState();
        s.watchOn = !!on;
        writeTabState(s);
    }

    function readIntervalOn() {
        return readTabState().intervalOn;
    }

    function writeIntervalOn(on) {
        var s = readTabState();
        s.intervalOn = !!on;
        writeTabState(s);
    }

    function intervalSecEffective() {
        return readTabState().intervalSec;
    }

    function writeIntervalSec(n) {
        var s = readTabState();
        s.intervalSec = n;
        writeTabState(s);
    }

    function readActionWatch() {
        return readTabState().actionWatch;
    }

    function writeActionWatch(a) {
        var s = readTabState();
        s.actionWatch =
            a === 'append' || a === 'remove' || a === 'replace' || a === '' ? a : '';
        writeTabState(s);
    }

    function readActionInterval() {
        return readTabState().actionInterval;
    }

    function writeActionInterval(a) {
        var s = readTabState();
        s.actionInterval =
            a === 'append' || a === 'remove' || a === 'replace' || a === '' ? a : '';
        writeTabState(s);
    }

    function readMetricsSet() {
        return readTabState().metrics;
    }

    function writeMetricsSet(o) {
        var s = readTabState();
        s.metrics = {
            tails: !!o.tails,
            lines: !!o.lines,
            flights: !!o.flights
        };
        if (!s.metrics.tails && !s.metrics.lines && !s.metrics.flights) {
            s.metrics = { tails: true, lines: true, flights: true };
        }
        writeTabState(s);
    }

    function readCollapsed() {
        return readTabState().collapsed;
    }

    function writeCollapsed(collapsed) {
        var s = readTabState();
        s.collapsed = !!collapsed;
        writeTabState(s);
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
        if (!action || action === '') {
            return false;
        }
        var name = labelForToolbarAction(action).toLowerCase();
        var btn = findToolbarButtonByLabel(name);
        if (!btn) {
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
        return true;
    }


    function tick() {
        if (!readWatchOn()) {
            return;
        }
        var c = scanCounts();
        var m = readMetricsSet();
        var sig = fingerprintForMetrics(c, m);
        if (!sig) {
            return;
        }
        var label = formatCountsLabel(c);
        var act = readActionWatch();
        if (!lastSig) {
            lastSig = sig;
            return;
        }
        if (!act) {
            if (sig !== lastSig) {
                lastSig = sig;
            }
            return;
        }
        if (sig !== lastSig) {
            lastSig = sig;
            clickToolbarAction(act, 'counts changed · ' + label);
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

    function intervalCountdownEl() {
        var h = document.getElementById(HOST_ID);
        return h ? h.querySelector('[data-dc-interval-countdown]') : null;
    }

    function setIntervalCountdownText(text) {
        var el = intervalCountdownEl();
        if (el) {
            el.textContent = text;
        }
    }

    function pad2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function formatCountdownSeconds(n) {
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
            return '—';
        }
        if (n >= 3600) {
            var h = Math.floor(n / 3600);
            var m = Math.floor((n % 3600) / 60);
            var s = n % 60;
            return h + ':' + pad2(m) + ':' + pad2(s);
        }
        if (n >= 60) {
            var mm = Math.floor(n / 60);
            var ss = n % 60;
            return mm + ':' + pad2(ss);
        }
        return String(n) + 's';
    }

    function stopIntervalReplace() {
        if (intervalTimer) {
            clearInterval(intervalTimer);
            intervalTimer = null;
        }
        setIntervalCountdownText('—');
    }

    /**
     * One 1s timer: countdown display + fire click when remaining hits 0 (synced, no drift).
     */
    function startIntervalReplace() {
        stopIntervalReplace();
        if (!readIntervalOn()) {
            return;
        }
        var remaining = intervalSecEffective();
        function tick() {
            if (!readIntervalOn()) {
                stopIntervalReplace();
                return;
            }
            if (remaining <= 0) {
                var ia = readActionInterval();
                if (ia) {
                    clickToolbarAction(ia, 'interval');
                }
                remaining = intervalSecEffective();
            }
            setIntervalCountdownText(formatCountdownSeconds(remaining));
            remaining--;
        }
        tick();
        intervalTimer = setInterval(tick, 1000);
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
            '{width:100%;margin-top:8px;box-sizing:border-box;font:11px/1.35 system-ui,sans-serif;color:#e8eef5;}' +
            '#' +
            HOST_ID +
            ' details.dc-war-details{background:rgba(30,40,55,0.92);border:1px solid #3d4f66;border-radius:6px;padding:0;overflow:hidden;width:100%;box-sizing:border-box;}' +
            '#' +
            HOST_ID +
            ' details.dc-war-details > summary{cursor:pointer;list-style:none;padding:4px;font-weight:600;color:#5dade2;user-select:none;}' +
            '#' +
            HOST_ID +
            ' details.dc-war-details > summary::-webkit-details-marker{display:none;}' +
            '#' +
            HOST_ID +
            ' .dc-war-body{padding:4px;display:flex;flex-direction:column;gap:4px;}' +
            '#' +
            HOST_ID +
            ' .dc-war-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;width:100%;}' +
            '#' +
            HOST_ID +
            ' .dc-war-divider{border:none;border-top:1px solid rgba(93,173,226,.35);margin:6px 0;width:100%;}' +
            '#' +
            HOST_ID +
            ' .dc-war-interval-row .dc-war-interval-left input[data-dc-interval-toggle]{flex-shrink:0;margin:0;accent-color:#5dade2;width:14px;height:14px;}' +
            '#' +
            HOST_ID +
            ' .dc-war-interval-left{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;flex:1;min-width:0;}' +
            '#' +
            HOST_ID +
            ' .dc-war-countdown{font-size:11px;color:#95a5a6;flex-shrink:0;margin-left:auto;min-width:4ch;text-align:right;font-variant-numeric:tabular-nums;}' +
            '#' +
            HOST_ID +
            ' label{cursor:pointer;display:inline-flex;align-items:center;gap:3px;user-select:none;font-size:11px;}' +
            '#' +
            HOST_ID +
            ' .dc-war-metric input[type="checkbox"]{accent-color:#5dade2;width:12px;height:12px;margin:0;flex-shrink:0;}' +
            '#' +
            HOST_ID +
            ' select.dc-war-sel{padding:2px 4px;border-radius:4px;border:1px solid #555;background:#1a1f28;color:#e8eef5;font-size:11px;max-width:100%;}' +
            '#' +
            HOST_ID +
            ' .dc-war-num{width:44px;padding:2px;border-radius:4px;border:1px solid #555;background:#1a1f28;color:#e8eef5;font-size:11px;}' +
            '#' +
            HOST_ID +
            '[data-dc-war-placed="0"]{visibility:hidden!important;opacity:0!important;pointer-events:none!important;}' +
            '#dc-war-op-time-wrap{' +
            'display:inline-flex!important;align-items:center!important;gap:6px!important;flex-wrap:wrap!important;margin:4px 0 0 0!important;vertical-align:baseline!important;' +
            'font:11px/1.2 system-ui,Segoe UI,sans-serif!important;color:#95a5a6!important;}' +
            '#dc-war-op-time-wrap input[type=checkbox]{accent-color:#5dade2;width:14px!important;height:14px!important;flex-shrink:0;margin:0!important;cursor:pointer;}' +
            '#dc-war-op-time-wrap > span{white-space:normal;max-width:100%;}';
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

    var OP_TIME_ID = 'dc-war-op-time-wrap';
    var OP_TIME_TICK_MS = 10 * 60 * 1000;

    function readOpTimeAuto() {
        return readTabState().opTimeAuto;
    }

    function writeOpTimeAuto(on) {
        var s = readTabState();
        s.opTimeAuto = !!on;
        writeTabState(s);
    }

    function findOperationalTimeField() {
        var wrap = document.querySelector('[data-testid="operational-time"]');
        if (!wrap) {
            return { field: null, afterEl: null, input: null, questionIcon: null };
        }
        var inp = wrap.querySelector('input[name="flight.operationalTime"]') ||
            wrap.querySelector('input[type="text"]');
        var field = wrap.closest('div.field') || null;
        var qIcon = field
            ? field.querySelector('i[data-testid="question-icon"]')
            : null;
        return { field: field, afterEl: qIcon, input: inp, questionIcon: qIcon, inputWrap: wrap };
    }

    function formatTime24hLocal() {
        var d = new Date();
        return '>' + pad2(d.getHours()) + pad2(d.getMinutes());
    }

    function setOperationalTimeInputValue(inp, value) {
        if (!inp) {
            return;
        }
        var s = String(value);
        var setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
        );
        if (setter && setter.set) {
            setter.set.call(inp, s);
        } else {
            inp.value = s;
        }
        try {
            if (typeof InputEvent !== 'undefined') {
                inp.dispatchEvent(
                    new InputEvent('input', {
                        bubbles: true,
                        cancelable: true,
                        data: s,
                        inputType: 'insertFromPaste'
                    })
                );
            }
        } catch (e) {}
        try {
            inp.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        } catch (e2) {}
    }

    function applyOperationalTimeNow() {
        if (!readOpTimeAuto()) {
            return;
        }
        if (!document.getElementById(OP_TIME_ID)) {
            return;
        }
        var inf = findOperationalTimeField();
        if (!inf.input) {
            return;
        }
        setOperationalTimeInputValue(inf.input, formatTime24hLocal());
    }

    function startOpTimeTick() {
        stopOpTimeTick();
        if (!readOpTimeAuto()) {
            return;
        }
        applyOperationalTimeNow();
        opTimeTid = setInterval(applyOperationalTimeNow, OP_TIME_TICK_MS);
    }

    function stopOpTimeTick() {
        if (opTimeTid) {
            clearInterval(opTimeTid);
            opTimeTid = null;
        }
    }

    function unmountOpTime() {
        stopOpTimeTick();
        var w = document.getElementById(OP_TIME_ID);
        if (w) {
            try {
                w.remove();
            } catch (e) {}
        }
    }

    function mountOperationalTimeIfNeeded() {
        var existing = document.getElementById(OP_TIME_ID);
        if (existing && !document.body.contains(existing)) {
            unmountOpTime();
            existing = null;
        }
        var inf = findOperationalTimeField();
        if (existing && (!inf.input || !inf.field || (inf.field && !inf.field.contains(existing)))) {
            unmountOpTime();
            existing = null;
        }
        if (document.getElementById(OP_TIME_ID)) {
            if (readOpTimeAuto() && !opTimeTid) {
                startOpTimeTick();
            }
            return;
        }
        if (!inf.field || !inf.input) {
            return;
        }
        if (!inf.inputWrap || !inf.inputWrap.parentNode) {
            return;
        }
        unmountOpTime();

        var line = document.createElement('div');
        line.id = OP_TIME_ID;
        line.className = 'dc-war-op-time';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.setAttribute('data-dc-op-time-cb', '1');
        cb.title = 'Fill OPERATIONAL TIME with the current time (24h, HHmm) and refresh every 10 minutes';
        cb.checked = readOpTimeAuto();
        var hint = document.createElement('span');
        hint.textContent = 'auto current time (24h, every 10 min) — this worksheet only';
        line.appendChild(cb);
        line.appendChild(hint);

        cb.addEventListener('change', function () {
            writeOpTimeAuto(!!cb.checked);
            if (cb.checked) {
                startOpTimeTick();
            } else {
                stopOpTimeTick();
            }
        });

        if (inf.afterEl && inf.afterEl.parentNode) {
            inf.afterEl.insertAdjacentElement('afterend', line);
        } else {
            if (inf.inputWrap && inf.inputWrap.parentNode) {
                try {
                    inf.inputWrap.parentNode.insertBefore(line, inf.inputWrap);
                } catch (e) {
                    inf.field.appendChild(line);
                }
            } else {
                inf.field.appendChild(line);
            }
        }
        if (readOpTimeAuto()) {
            startOpTimeTick();
        }
    }

    var HOST_HTML =
        '<details class="dc-war-details">' +
        '<summary>Worksheet auto filter actions (this tab only)</summary>' +
        '<div class="dc-war-body">' +
        '<div class="dc-war-row dc-war-watch-row">' +
        '<label><input type="checkbox" data-dc-watch-toggle /> Watch for change to…</label>' +
        '<label class="dc-war-metric"><input type="checkbox" data-dc-metric="tails" />AC</label>' +
        '<label class="dc-war-metric"><input type="checkbox" data-dc-metric="lines" />LN</label>' +
        '<label class="dc-war-metric"><input type="checkbox" data-dc-metric="flights" />FLT</label>' +
        '<select class="dc-war-sel" data-dc-action-watch title="Toolbar button when counts change">' +
        '<option value="">Pick a button…</option>' +
        '<option value="replace">Replace</option><option value="append">Append</option><option value="remove">Remove</option>' +
        '</select>' +
        '</div>' +
        '<hr class="dc-war-divider" />' +
        '<div class="dc-war-row dc-war-interval-row">' +
        '<div class="dc-war-interval-left">' +
        '<input type="checkbox" data-dc-interval-toggle title="Interval clicks" />' +
        '<select class="dc-war-sel" data-dc-action-interval title="Toolbar button on interval">' +
        '<option value="">Pick a button…</option>' +
        '<option value="replace">Replace</option><option value="append">Append</option><option value="remove">Remove</option>' +
        '</select>' +
        '<span>every</span>' +
        '<input type="number" class="dc-war-num" min="5" max="3600" step="1" data-dc-interval-sec title="Seconds" />' +
        '<span>sec</span>' +
        '</div>' +
        '<span class="dc-war-countdown" data-dc-interval-countdown>—</span>' +
        '</div>' +
        '</div>' +
        '</details>';

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
            toggleInput = wt;
            var detR = wrap.querySelector('details.dc-war-details');
            if (detR) {
                detR.open = !readCollapsed();
            }
            return;
        }
        wrap.setAttribute('data-dc-war-bound', '1');
        hostEl = wrap;
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
                }
            });
        }
        var det = wrap.querySelector('details.dc-war-details');
        if (det) {
            det.open = !readCollapsed();
            det.addEventListener('toggle', function () {
                writeCollapsed(!det.open);
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
            if (!existing.querySelector('details.dc-war-details') || !existing.querySelector('[data-dc-interval-countdown]')) {
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
        }
        if (readIntervalOn()) {
            startIntervalReplace();
        }
        startRelocateRetries();
    }

    function tryMount() {
        mountHost();
        try {
            mountOperationalTimeIfNeeded();
        } catch (e) {}
    }

    function init() {
        tryMount();
        mo = new MutationObserver(function () {
            if (!document.getElementById(HOST_ID)) {
                tryMount();
            } else {
                scheduleRelocateHost();
            }
            try {
                mountOperationalTimeIfNeeded();
            } catch (e) {}
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.__myScriptCleanup = function () {
        unmountOpTime();
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
        toggleInput = null;
        window.__myScriptCleanup = undefined;
    };
})();
