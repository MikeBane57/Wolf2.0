// ==UserScript==
// @name         Worksheet auto filter actions
// @namespace    Wolf 2.0
// @version      1.4.17
// @description  Worksheet: watch & interval as toggle switches; both actions default to Pick a button.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        none
// @donkeycode-pref {"worksheetAutoReplacePollMs":{"type":"number","group":"Auto filter actions","label":"Check interval (ms)","description":"How often to re-read counts from the page while the watch is on.","default":800,"min":200,"max":10000,"step":100},"worksheetAutoReplaceIntervalSec":{"type":"number","group":"Auto filter actions","label":"Interval (seconds)","description":"Default seconds for interval clicks when interval mode is on (min 5).","default":30,"min":5,"max":3600,"step":1},"worksheetAutoReplaceDebug":{"type":"boolean","group":"Auto filter actions","label":"Debug interval actions","description":"Log interval row countdown/click state to the browser console.","default":false}}
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
    var intervalNextDueById = Object.create(null);
    var relocateRetryTimer = null;
    var mo = null;
    var relocateRaf = 0;
    var filterPadRaf = 0;
    var filterPadRetryTimer = null;
    var filterPadRetryCount = 0;
    var lastSig = '';
    var lastAdvancedFilterPadLogKey = '';
    var lastAdvancedFilterPadLogAt = 0;
    var hostEl = null;
    var toggleInput = null;
    var opTimeTid = null;
    var ADVANCED_FILTER_MIN_BOTTOM_PAD = 200;
    var ADVANCED_FILTER_SECTION_TITLES = [
        'Fleet',
        'Aircraft',
        'Maintenance',
        'Route',
        'Flight',
        'Operation',
        'Equipment'
    ];
    var SMART_WIDGET_ADVANCED_FILTER_SELECTOR =
        '#smart-widget > div > section > div.k-FiYKNfW8E\\= > div.SCnr-Yt9a28\\= > div > div > div > div > div.KU0FYL-A87M\\=';

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

    function intervalDebugOn() {
        return getPref('worksheetAutoReplaceDebug', false) !== false;
    }

    function debugInterval() {
        if (!intervalDebugOn()) {
            return;
        }
        try {
            console.log.apply(
                console,
                ['%c[WS-AUTO-FILTER interval]', 'color:#5dade2;font-weight:600;'].concat(
                    [].slice.call(arguments)
                )
            );
        } catch (e) {}
    }

    function debugAdvancedFilterPad() {
        var args = ['%c[WS-AUTO-FILTER advanced-filter pad]', 'color:#58d68d;font-weight:600;'].concat(
            [].slice.call(arguments)
        );
        try {
            console.info.apply(console, args);
        } catch (e) {}
        try {
            debugInterval.apply(null, [].slice.call(arguments));
        } catch (e2) {}
    }

    function elClassSnippet(el, maxLen) {
        if (!el || el.className == null) {
            return '';
        }
        var s = typeof el.className === 'string' ? el.className : String(el.className);
        var n = maxLen == null ? 96 : maxLen;
        return s.length > n ? s.slice(0, n) + '…' : s;
    }

    function maybeLogAdvancedFilterPad(payload) {
        var now = Date.now();
        var key = [
            payload.reason || '',
            String(payload.pad || ''),
            payload.usedScrollPort ? '1' : '0',
            elClassSnippet(payload.padEl, 48),
            elClassSnippet(payload.innerTarget, 48)
        ].join('|');
        if (key === lastAdvancedFilterPadLogKey && now - lastAdvancedFilterPadLogAt < 2000) {
            return;
        }
        lastAdvancedFilterPadLogKey = key;
        lastAdvancedFilterPadLogAt = now;
        debugAdvancedFilterPad('advanced filter bottom padding', payload);
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

    function normalizeIntervalSec(n) {
        var x = Number(n);
        if (!Number.isFinite(x)) {
            x = intervalSecFromPref();
        }
        return Math.min(3600, Math.max(5, Math.floor(x)));
    }

    function normalizeAction(a) {
        return a === 'append' || a === 'remove' || a === 'replace' ? a : '';
    }

    function cssAttrEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(String(value));
        }
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function htmlAttrEscape(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function makeIntervalRow(seed) {
        seed = seed || {};
        return {
            id: String(seed.id || ('row' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))),
            on: !!seed.on,
            sec: normalizeIntervalSec(seed.sec),
            action: normalizeAction(seed.action)
        };
    }

    function defaultIntervalRows() {
        return [
            makeIntervalRow({
                id: 'default',
                on: false,
                sec: intervalSecFromPref(),
                action: ''
            })
        ];
    }

    function normalizeIntervalRows(source) {
        var raw = [];
        if (Array.isArray(source)) {
            raw = source;
        } else if (source && Array.isArray(source.intervalRows)) {
            raw = source.intervalRows;
        } else if (source && typeof source === 'object') {
            raw = [
                {
                    id: 'default',
                    on: !!source.intervalOn,
                    sec: source.intervalSec,
                    action: source.actionInterval
                }
            ];
        }
        var out = [];
        for (var i = 0; i < raw.length; i++) {
            var row = makeIntervalRow(raw[i]);
            if (!row.id) {
                row.id = 'row' + String(i + 1);
            }
            out.push(row);
        }
        return out.length ? out : defaultIntervalRows();
    }

    function syncLegacyIntervalFields(state) {
        var rows = normalizeIntervalRows(state.intervalRows);
        state.intervalRows = rows;
        state.intervalOn = !!(rows[0] && rows[0].on);
        state.intervalSec = rows[0] ? rows[0].sec : intervalSecFromPref();
        state.actionInterval = rows[0] ? rows[0].action : '';
    }

    function defaultTabState() {
        return {
            watchOn: false,
            intervalOn: false,
            intervalSec: intervalSecFromPref(),
            actionWatch: '',
            actionInterval: '',
            intervalRows: defaultIntervalRows(),
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
            if (aw === 'append' || aw === 'remove' || aw === 'replace') {
                s.actionWatch = aw;
            }
        } catch (e) {}
        try {
            var ai = localStorage.getItem(LS_ACTION_INTERVAL);
            if (ai === 'append' || ai === 'remove' || ai === 'replace') {
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
        s.intervalRows = normalizeIntervalRows({
            intervalOn: s.intervalOn,
            intervalSec: s.intervalSec,
            actionInterval: s.actionInterval
        });
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
            o.intervalRows = normalizeIntervalRows(s);
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
        syncLegacyIntervalFields(next);
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
        var rows = readIntervalRows();
        return !!(rows[0] && rows[0].on);
    }

    function writeIntervalOn(on) {
        var s = readTabState();
        s.intervalRows = normalizeIntervalRows(s.intervalRows);
        s.intervalRows[0].on = !!on;
        syncLegacyIntervalFields(s);
        writeTabState(s);
    }

    function intervalSecEffective() {
        var rows = readIntervalRows();
        return rows[0] ? rows[0].sec : intervalSecFromPref();
    }

    function writeIntervalSec(n) {
        var s = readTabState();
        s.intervalRows = normalizeIntervalRows(s.intervalRows);
        s.intervalRows[0].sec = normalizeIntervalSec(n);
        syncLegacyIntervalFields(s);
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
        var rows = readIntervalRows();
        return rows[0] ? rows[0].action : '';
    }

    function writeActionInterval(a) {
        var s = readTabState();
        s.intervalRows = normalizeIntervalRows(s.intervalRows);
        s.intervalRows[0].action = normalizeAction(a);
        syncLegacyIntervalFields(s);
        writeTabState(s);
    }

    function readIntervalRows() {
        return normalizeIntervalRows(readTabState().intervalRows);
    }

    function writeIntervalRows(rows) {
        var s = readTabState();
        s.intervalRows = normalizeIntervalRows(rows);
        syncLegacyIntervalFields(s);
        writeTabState(s);
    }

    function updateIntervalRow(rowId, patch) {
        var rows = readIntervalRows();
        var found = false;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].id !== rowId) {
                continue;
            }
            if (patch.on !== undefined) {
                rows[i].on = !!patch.on;
            }
            if (patch.sec !== undefined) {
                rows[i].sec = normalizeIntervalSec(patch.sec);
            }
            if (patch.action !== undefined) {
                rows[i].action = normalizeAction(patch.action);
            }
            found = true;
            break;
        }
        if (found) {
            writeIntervalRows(rows);
        }
    }

    function addIntervalRow() {
        var rows = readIntervalRows();
        var prev = rows.length ? rows[rows.length - 1] : null;
        rows.push(
            makeIntervalRow({
                on: false,
                sec: prev ? prev.sec : intervalSecFromPref(),
                action: prev ? prev.action : ''
            })
        );
        writeIntervalRows(rows);
    }

    function removeIntervalRow(rowId) {
        var rows = readIntervalRows();
        if (!rows.length || rows[0].id === rowId) {
            return;
        }
        rows = rows.filter(function (row, idx) {
            return idx === 0 || row.id !== rowId;
        });
        writeIntervalRows(rows);
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

    function intervalCountdownEl(rowId) {
        var h = document.getElementById(HOST_ID);
        if (!h) {
            return null;
        }
        if (rowId) {
            return h.querySelector(
                '[data-dc-interval-row-id="' +
                    cssAttrEscape(rowId) +
                    '"] [data-dc-interval-countdown]'
            );
        }
        return h.querySelector('[data-dc-interval-countdown]');
    }

    function setIntervalCountdownText(rowId, text) {
        var el = intervalCountdownEl(rowId);
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

    function resetIntervalCountdowns() {
        var h = document.getElementById(HOST_ID);
        if (!h) {
            return;
        }
        var list = h.querySelectorAll('[data-dc-interval-countdown]');
        for (var i = 0; i < list.length; i++) {
            list[i].textContent = '';
        }
    }

    function stopIntervalReplace() {
        if (intervalTimer) {
            clearInterval(intervalTimer);
            intervalTimer = null;
        }
        intervalNextDueById = Object.create(null);
        resetIntervalCountdowns();
    }

    function anyIntervalRowOn(rows) {
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].on) {
                return true;
            }
        }
        return false;
    }

    function intervalNextDueFromNow(row, nowMs) {
        return nowMs + normalizeIntervalSec(row && row.sec) * 1000;
    }

    function resetIntervalRowClock(rowId, sec) {
        var n = sec !== undefined ? normalizeIntervalSec(sec) : null;
        if (n == null) {
            var rows = readIntervalRows();
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].id === rowId) {
                    n = rows[i].sec;
                    break;
                }
            }
        }
        if (n == null) {
            return;
        }
        intervalNextDueById[rowId] = Date.now() + n * 1000;
        setIntervalCountdownText(rowId, formatCountdownSeconds(n));
        debugInterval('row clock reset', {
            id: rowId,
            sec: n,
            nextDue: intervalNextDueById[rowId]
        });
    }

    function intervalCountdownLabel(row, nowMs) {
        if (!row || !row.on) {
            return '';
        }
        var due = intervalNextDueById[row.id];
        if (!Number.isFinite(due)) {
            return formatCountdownSeconds(row.sec);
        }
        return formatCountdownSeconds(
            Math.max(0, Math.ceil((due - nowMs) / 1000))
        );
    }

    function clickIntervalRowAction(row) {
        if (!row || !row.action) {
            debugInterval('click skipped', {
                id: row && row.id,
                reason: 'no action'
            });
            return;
        }
        debugInterval('click attempt', {
            id: row.id,
            action: row.action,
            sec: row.sec
        });
        if (!clickToolbarAction(row.action, 'interval ' + row.sec + 's')) {
            debugInterval('click retry scheduled', {
                id: row.id,
                action: row.action,
                sec: row.sec
            });
            setTimeout(function (act, sec) {
                var ok = clickToolbarAction(act, 'interval retry ' + sec + 's');
                debugInterval('click retry result', {
                    action: act,
                    sec: sec,
                    ok: ok
                });
            }, 250, row.action, row.sec);
        } else {
            debugInterval('click success', {
                id: row.id,
                action: row.action
            });
        }
    }

    /**
     * One shared 1s clock drives all interval rows. Each row stores its next due
     * timestamp, so rows stay synced to the same clock without relying on drift-prone
     * per-row counters.
     */
    function tickIntervalRows() {
        var current = readIntervalRows();
        var now = Date.now();
        if (!anyIntervalRowOn(current)) {
            stopIntervalReplace();
            return;
        }
        for (var j = 0; j < current.length; j++) {
            var row = current[j];
            if (!row.on) {
                delete intervalNextDueById[row.id];
                setIntervalCountdownText(row.id, '');
                continue;
            }
            if (!Number.isFinite(intervalNextDueById[row.id])) {
                intervalNextDueById[row.id] = intervalNextDueFromNow(row, now);
                debugInterval('row clock initialized', {
                    id: row.id,
                    sec: row.sec,
                    nextDue: intervalNextDueById[row.id]
                });
            }
            while (now >= intervalNextDueById[row.id]) {
                debugInterval('row due', {
                    id: row.id,
                    action: row.action,
                    sec: row.sec,
                    now: now,
                    nextDue: intervalNextDueById[row.id]
                });
                clickIntervalRowAction(row);
                intervalNextDueById[row.id] += normalizeIntervalSec(row.sec) * 1000;
            }
            setIntervalCountdownText(
                row.id,
                formatCountdownSeconds(
                    Math.max(0, Math.ceil((intervalNextDueById[row.id] - now) / 1000))
                )
            );
        }
    }

    function startIntervalReplace() {
        var rows = readIntervalRows();
        var now = Date.now();
        if (!anyIntervalRowOn(rows)) {
            debugInterval('interval runner stop requested: no rows on');
            stopIntervalReplace();
            return;
        }
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].on && !Number.isFinite(intervalNextDueById[rows[i].id])) {
                intervalNextDueById[rows[i].id] = intervalNextDueFromNow(rows[i], now);
                debugInterval('row clock initialized on start', {
                    id: rows[i].id,
                    sec: rows[i].sec,
                    nextDue: intervalNextDueById[rows[i].id]
                });
            }
        }
        tickIntervalRows();
        if (!intervalTimer) {
            intervalTimer = setInterval(tickIntervalRows, 1000);
            debugInterval('interval runner started', {
                rows: rows
            });
        }
    }

    function ensureIntervalReplaceRunning() {
        startIntervalReplace();
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
            ' .dc-war-toggle{position:relative;display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;}' +
            '#' +
            HOST_ID +
            ' .dc-war-toggle input.dc-war-toggle-input{position:absolute;opacity:0;width:0;height:0;margin:0;}' +
            '#' +
            HOST_ID +
            ' .dc-war-toggle .dc-war-toggle-track{position:relative;flex-shrink:0;width:32px;height:18px;background:#3d4555;border-radius:9px;transition:background .18s ease;border:1px solid #555;}' +
            '#' +
            HOST_ID +
            ' .dc-war-toggle .dc-war-toggle-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;background:#e8eef5;border-radius:50%;transition:transform .18s ease;box-shadow:0 1px 2px rgba(0,0,0,.35);}' +
            '#' +
            HOST_ID +
            ' .dc-war-toggle input:checked + .dc-war-toggle-track{background:#2e7d9e;border-color:#5dade2;}' +
            '#' +
            HOST_ID +
            ' .dc-war-toggle input:checked + .dc-war-toggle-track .dc-war-toggle-knob{transform:translateX(14px);}' +
            '#' +
            HOST_ID +
            ' .dc-war-toggle input:focus-visible + .dc-war-toggle-track{outline:2px solid #5dade2;outline-offset:2px;}' +
            '#' +
            HOST_ID +
            ' .dc-war-toggle-interval{margin-right:2px;}' +
            '#' +
            HOST_ID +
            ' .dc-war-interval-left{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;flex:1;min-width:0;}' +
            '#' +
            HOST_ID +
            ' .dc-war-countdown{font-size:11px;color:#95a5a6;flex-shrink:0;margin-left:auto;min-width:4ch;text-align:right;font-variant-numeric:tabular-nums;}' +
            '#' +
            HOST_ID +
            ' .dc-war-icon-btn{width:20px;height:20px;line-height:18px;padding:0;border-radius:50%;border:1px solid #5dade2;background:#1a1f28;color:#5dade2;font-weight:700;cursor:pointer;flex-shrink:0;text-align:center;}' +
            '#' +
            HOST_ID +
            ' .dc-war-icon-btn[data-dc-remove-interval]{border-color:#7f8c8d;color:#bdc3c7;}' +
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

    function findAutoActionsDetails() {
        var host = document.getElementById(HOST_ID);
        return host && host.querySelector
            ? host.querySelector('details.dc-war-details') || host
            : null;
    }

    function textHasAdvancedFilter(el) {
        return !!(
            el &&
            (el.textContent || '').replace(/\s+/g, ' ').indexOf('Advanced Filter') >= 0
        );
    }

    function visible(el) {
        if (!el || !el.getClientRects || !el.getClientRects().length) {
            return false;
        }
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        return !style || (style.visibility !== 'hidden' && style.display !== 'none');
    }

    function isAdvancedFilterTitleCandidate(el) {
        if (!textHasAdvancedFilter(el) || !visible(el)) {
            return false;
        }
        var tag = (el.tagName || '').toLowerCase();
        if (/^h[1-6]$/.test(tag) || tag === 'legend' || tag === 'summary' || tag === 'label') {
            return true;
        }
        return (el.children || []).length <= 2;
    }

    function normalizedText(el) {
        return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
    }

    function advancedFilterSectionTitleCount(grid) {
        if (!grid || !grid.children) {
            return 0;
        }
        var found = Object.create(null);
        for (var i = 0; i < grid.children.length; i++) {
            var col = grid.children[i];
            if (!col || !col.querySelector) {
                continue;
            }
            var title = col.querySelector(':scope > .title') || col.querySelector('.title');
            var txt = normalizedText(title);
            for (var j = 0; j < ADVANCED_FILTER_SECTION_TITLES.length; j++) {
                var expected = ADVANCED_FILTER_SECTION_TITLES[j];
                if (txt.indexOf(expected) === 0) {
                    found[expected] = true;
                    break;
                }
            }
        }
        var n = 0;
        for (var k in found) {
            if (Object.prototype.hasOwnProperty.call(found, k)) {
                n++;
            }
        }
        return n;
    }

    function findAdvancedFilterGridBySections() {
        var grids = document.querySelectorAll('.ui.stackable.grid');
        var best = null;
        var bestScore = 0;
        for (var i = 0; i < grids.length; i++) {
            var score = advancedFilterSectionTitleCount(grids[i]);
            if (score > bestScore) {
                best = grids[i];
                bestScore = score;
            }
        }
        return bestScore >= 4 ? best : null;
    }

    function findSmartWidgetAdvancedFilterPaddingTarget() {
        try {
            return document.querySelector(SMART_WIDGET_ADVANCED_FILTER_SELECTOR);
        } catch (e) {
            debugInterval('smart widget advanced filter selector failed', e);
            return null;
        }
    }

    function findAdvancedFilterPaddingTarget() {
        var smartWidgetTarget = findSmartWidgetAdvancedFilterPaddingTarget();
        if (smartWidgetTarget) {
            return { target: smartWidgetTarget, reason: 'smart_widget_css_selector' };
        }
        var sectionGrid = findAdvancedFilterGridBySections();
        if (sectionGrid) {
            return { target: sectionGrid, reason: 'section_title_grid_heuristic' };
        }
        var titles = document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,summary,label,div,span,p');
        for (var i = 0; i < titles.length; i++) {
            if (!isAdvancedFilterTitleCandidate(titles[i])) {
                continue;
            }
            var scope = titles[i].parentElement;
            for (var up = 0; scope && scope !== document.body && up < 8; up++) {
                if (scope.querySelector) {
                    var scopedGrid = scope.querySelector('.accordion.ui.inverted .ui.stackable.grid') ||
                        scope.querySelector('.accordion .ui.stackable.grid') ||
                        scope.querySelector('.ui.stackable.grid');
                    if (scopedGrid) {
                        return { target: scopedGrid, reason: 'title_ancestor_stackable_grid' };
                    }
                }
                scope = scope.parentElement;
            }
            var siblingRoot = titles[i].parentElement;
            if (siblingRoot) {
                var siblings = siblingRoot.children || [];
                var start = -1;
                for (var s = 0; s < siblings.length; s++) {
                    if (siblings[s] === titles[i] || (siblings[s].contains && siblings[s].contains(titles[i]))) {
                        start = s;
                        break;
                    }
                }
                for (var j = start + 1; j >= 1 && j < siblings.length && j <= start + 4; j++) {
                    if (siblings[j].matches && siblings[j].matches('.ui.stackable.grid')) {
                        return { target: siblings[j], reason: 'title_sibling_stackable_grid' };
                    }
                    if (siblings[j].querySelector) {
                        var siblingGrid = siblings[j].querySelector('.ui.stackable.grid');
                        if (siblingGrid) {
                            return { target: siblingGrid, reason: 'title_sibling_nested_stackable_grid' };
                        }
                    }
                }
            }
        }
        var grids = document.querySelectorAll('.accordion.ui.inverted .ui.stackable.grid,.accordion .ui.stackable.grid');
        if (grids.length === 1) {
            return { target: grids[0], reason: 'single_accordion_stackable_grid' };
        }
        return { target: null, reason: 'none' };
    }

    /**
     * Advanced filter content often sits inside a flex column whose *ancestor* is the
     * overflow:auto scrollport. Padding only the inner grid then does not grow scrollHeight,
     * so the bottom stays clipped. Prefer the nearest scrollport (this node or an ancestor).
     */
    function overflowYCreatesScrollport(style) {
        if (!style) {
            return false;
        }
        var oy = style.overflowY;
        var fall = style.overflow;
        return (
            oy === 'auto' ||
            oy === 'scroll' ||
            oy === 'overlay' ||
            fall === 'auto' ||
            fall === 'scroll' ||
            fall === 'overlay'
        );
    }

    function findAdvancedFilterScrollPort(from) {
        if (!from) {
            return null;
        }
        var el = from;
        var depth = 0;
        while (el && depth < 32) {
            if (window.getComputedStyle) {
                try {
                    var st = window.getComputedStyle(el);
                    if (overflowYCreatesScrollport(st)) {
                        return el;
                    }
                } catch (e) {}
            }
            if (el === document.documentElement) {
                break;
            }
            el = el.parentElement;
            depth++;
        }
        return null;
    }

    function restoreAdvancedFilterBottomPadding() {
        var list = document.querySelectorAll('[data-dc-war-bottom-pad]');
        for (var i = 0; i < list.length; i++) {
            list[i].style.removeProperty('padding-bottom');
            list[i].removeAttribute('data-dc-war-bottom-pad');
            list[i].removeAttribute('data-dc-war-bottom-pad-px');
        }
    }

    function updateAdvancedFilterBottomPadding() {
        restoreAdvancedFilterBottomPadding();
        var found = findAdvancedFilterPaddingTarget();
        var target = found && found.target;
        var details = findAutoActionsDetails();
        if (!target) {
            maybeLogAdvancedFilterPad({
                reason: found && found.reason ? found.reason : 'none',
                pad: 0,
                usedScrollPort: false,
                innerTarget: null,
                padEl: null,
                selectorMatched: false,
                smartWidgetSelector: SMART_WIDGET_ADVANCED_FILTER_SELECTOR,
                note: 'padding target not found'
            });
            debugInterval('advanced filter padding target not found', {
                reason: found && found.reason ? found.reason : 'none'
            });
            return false;
        }
        var h = details && details.getBoundingClientRect
            ? Math.ceil(details.getBoundingClientRect().height || 0)
            : 0;
        var pad = Math.max(ADVANCED_FILTER_MIN_BOTTOM_PAD, h);
        if (!Number.isFinite(pad) || pad < ADVANCED_FILTER_MIN_BOTTOM_PAD) {
            pad = ADVANCED_FILTER_MIN_BOTTOM_PAD;
        }
        var scrollPort = findAdvancedFilterScrollPort(target);
        var padEl = scrollPort || target;
        padEl.style.setProperty('padding-bottom', pad + 'px', 'important');
        padEl.setAttribute('data-dc-war-bottom-pad', '1');
        padEl.setAttribute('data-dc-war-bottom-pad-px', String(pad));
        var inlinePb = '';
        var computedPb = '';
        var scrollH = null;
        var clientH = null;
        var overflowY = '';
        var flexGrow = '';
        try {
            inlinePb = padEl.style && padEl.style.getPropertyValue
                ? padEl.style.getPropertyValue('padding-bottom')
                : '';
        } catch (ePb) {}
        if (window.getComputedStyle) {
            try {
                var cs = window.getComputedStyle(padEl);
                computedPb = cs ? cs.paddingBottom : '';
                overflowY = cs ? cs.overflowY : '';
                flexGrow = cs ? cs.flexGrow : '';
            } catch (eCs) {}
        }
        try {
            scrollH = padEl.scrollHeight;
            clientH = padEl.clientHeight;
        } catch (eSh) {}
        var payload = {
            reason: found.reason || 'unknown',
            pad: pad,
            detailsBarHeight: h,
            usedScrollPort: !!scrollPort,
            innerTarget: target,
            padEl: padEl,
            selectorMatched: found.reason === 'smart_widget_css_selector',
            smartWidgetSelector: SMART_WIDGET_ADVANCED_FILTER_SELECTOR,
            innerTag: target.tagName || '',
            innerClass: elClassSnippet(target, 120),
            padTag: padEl.tagName || '',
            padClass: elClassSnippet(padEl, 120),
            inlinePaddingBottom: inlinePb,
            computedPaddingBottom: computedPb,
            padElOverflowY: overflowY,
            padElFlexGrow: flexGrow,
            scrollHeight: scrollH,
            clientHeight: clientH
        };
        maybeLogAdvancedFilterPad(payload);
        debugInterval('advanced filter padding applied', payload);
        return true;
    }

    function scheduleAdvancedFilterBottomPadding() {
        if (filterPadRaf) {
            cancelAnimationFrame(filterPadRaf);
        }
        filterPadRaf = requestAnimationFrame(function () {
            filterPadRaf = 0;
            if (updateAdvancedFilterBottomPadding()) {
                filterPadRetryCount = 0;
                if (filterPadRetryTimer) {
                    clearInterval(filterPadRetryTimer);
                    filterPadRetryTimer = null;
                }
                return;
            }
            if (!filterPadRetryTimer) {
                filterPadRetryCount = 0;
                filterPadRetryTimer = setInterval(function () {
                    filterPadRetryCount++;
                    if (updateAdvancedFilterBottomPadding() || filterPadRetryCount >= 20) {
                        clearInterval(filterPadRetryTimer);
                        filterPadRetryTimer = null;
                    }
                }, 250);
            }
        });
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
        scheduleAdvancedFilterBottomPadding();
        relocateRaf = requestAnimationFrame(function () {
            relocateRaf = 0;
            relocateHost();
            scheduleAdvancedFilterBottomPadding();
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
        '<label class="dc-war-toggle">' +
        '<input type="checkbox" class="dc-war-toggle-input" data-dc-watch-toggle />' +
        '<span class="dc-war-toggle-track" aria-hidden="true"><span class="dc-war-toggle-knob"></span></span>' +
        '<span>Watch for change to…</span>' +
        '</label>' +
        '<label class="dc-war-metric"><input type="checkbox" data-dc-metric="tails" />AC</label>' +
        '<label class="dc-war-metric"><input type="checkbox" data-dc-metric="lines" />LN</label>' +
        '<label class="dc-war-metric"><input type="checkbox" data-dc-metric="flights" />FLT</label>' +
        '<select class="dc-war-sel" data-dc-action-watch title="Toolbar button when counts change">' +
        '<option value="">Pick a button…</option>' +
        '<option value="replace">Replace</option><option value="append">Append</option><option value="remove">Remove</option>' +
        '</select>' +
        '</div>' +
        '<hr class="dc-war-divider" />' +
        '<div class="dc-war-interval-list" data-dc-interval-list></div>' +
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

    function intervalActionOptionsHtml(selected) {
        return (
            '<option value=""' +
            (selected === '' ? ' selected' : '') +
            '>Pick a button…</option>' +
            '<option value="replace"' +
            (selected === 'replace' ? ' selected' : '') +
            '>Replace</option>' +
            '<option value="append"' +
            (selected === 'append' ? ' selected' : '') +
            '>Append</option>' +
            '<option value="remove"' +
            (selected === 'remove' ? ' selected' : '') +
            '>Remove</option>'
        );
    }

    function intervalRowCountdownText(row) {
        return row && row.on ? intervalCountdownLabel(row, Date.now()) : '';
    }

    function intervalRowHtml(row, idx, count) {
        var id = String(row.id);
        return (
            '<div class="dc-war-row dc-war-interval-row" data-dc-interval-row-id="' +
            htmlAttrEscape(id) +
            '">' +
            '<div class="dc-war-interval-left">' +
            '<label class="dc-war-toggle dc-war-toggle-interval" title="Interval toolbar clicks">' +
            '<input type="checkbox" class="dc-war-toggle-input" data-dc-interval-toggle ' +
            (row.on ? 'checked ' : '') +
            '/>' +
            '<span class="dc-war-toggle-track" aria-hidden="true"><span class="dc-war-toggle-knob"></span></span>' +
            '</label>' +
            '<select class="dc-war-sel" data-dc-action-interval title="Toolbar button on interval">' +
            intervalActionOptionsHtml(row.action) +
            '</select>' +
            '<span>every</span>' +
            '<input type="number" class="dc-war-num" min="5" max="3600" step="1" data-dc-interval-sec title="Seconds" value="' +
            String(row.sec) +
            '" />' +
            '<span>sec</span>' +
            '</div>' +
            '<span class="dc-war-countdown" data-dc-interval-countdown>' +
            intervalRowCountdownText(row) +
            '</span>' +
            '<button type="button" class="dc-war-icon-btn" data-dc-add-interval data-dc-interval-btn-row-id="' +
            htmlAttrEscape(id) +
            '" title="Add another interval row">+</button>' +
            (idx > 0
                ? '<button type="button" class="dc-war-icon-btn" data-dc-remove-interval data-dc-interval-btn-row-id="' +
                    htmlAttrEscape(id) +
                    '" title="Remove this interval row">-</button>'
                : '') +
            '</div>'
        );
    }

    function updateRenderedIntervalCountdowns(host) {
        var h = host || document.getElementById(HOST_ID);
        if (!h) {
            return;
        }
        var rows = readIntervalRows();
        for (var i = 0; i < rows.length; i++) {
            setIntervalCountdownText(
                rows[i].id,
                rows[i].on ? intervalCountdownLabel(rows[i], Date.now()) : ''
            );
        }
    }

    function renderIntervalRows(host) {
        var list = host.querySelector('[data-dc-interval-list]');
        if (!list) {
            return;
        }
        var rows = readIntervalRows();
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            html += intervalRowHtml(rows[i], i, rows.length);
        }
        list.innerHTML = html;
        updateRenderedIntervalCountdowns(host);
        scheduleAdvancedFilterBottomPadding();
    }

    function refreshIntervalRows(host) {
        renderIntervalRows(host);
        if (anyIntervalRowOn(readIntervalRows())) {
            ensureIntervalReplaceRunning();
        } else {
            stopIntervalReplace();
        }
    }

    function closestIntervalButton(target, selector) {
        if (!target || !target.closest) {
            return null;
        }
        return target.closest(selector);
    }

    function intervalRowIdFromControl(el) {
        var row = el && el.closest ? el.closest('[data-dc-interval-row-id]') : null;
        return row ? row.getAttribute('data-dc-interval-row-id') || '' : '';
    }

    function bindIntervalListControls(wrap) {
        var intervalList = wrap.querySelector('[data-dc-interval-list]');
        if (!intervalList || intervalList.getAttribute('data-dc-interval-bound') === '1') {
            return;
        }
        intervalList.setAttribute('data-dc-interval-bound', '1');
        intervalList.addEventListener('change', function (ev) {
            var rowId = intervalRowIdFromControl(ev.target);
            if (!rowId) {
                return;
            }
            if (ev.target.matches && ev.target.matches('select[data-dc-action-interval]')) {
                updateIntervalRow(rowId, { action: ev.target.value });
                ensureIntervalReplaceRunning();
                return;
            }
            if (ev.target.matches && ev.target.matches('input[data-dc-interval-sec]')) {
                var v = parseInt(ev.target.value, 10);
                if (!Number.isFinite(v)) {
                    renderIntervalRows(wrap);
                    return;
                }
                v = normalizeIntervalSec(v);
                ev.target.value = String(v);
                updateIntervalRow(rowId, { sec: v });
                resetIntervalRowClock(rowId, v);
                ensureIntervalReplaceRunning();
                return;
            }
            if (ev.target.matches && ev.target.matches('input[data-dc-interval-toggle]')) {
                updateIntervalRow(rowId, { on: ev.target.checked });
                if (ev.target.checked) {
                    resetIntervalRowClock(rowId);
                } else {
                    delete intervalNextDueById[rowId];
                    setIntervalCountdownText(rowId, '');
                }
                ensureIntervalReplaceRunning();
            }
        });
        intervalList.addEventListener('click', function (ev) {
            var addBtn = closestIntervalButton(ev.target, '[data-dc-add-interval]');
            if (addBtn && intervalList.contains(addBtn)) {
                ev.preventDefault();
                ev.stopPropagation();
                addIntervalRow();
                renderIntervalRows(wrap);
                debugInterval('interval row added', readIntervalRows());
                return;
            }
            var removeBtn = closestIntervalButton(ev.target, '[data-dc-remove-interval]');
            if (removeBtn && intervalList.contains(removeBtn)) {
                ev.preventDefault();
                ev.stopPropagation();
                var rowId =
                    removeBtn.getAttribute('data-dc-interval-btn-row-id') ||
                    intervalRowIdFromControl(removeBtn);
                if (rowId) {
                    removeIntervalRow(rowId);
                    refreshIntervalRows(wrap);
                }
            }
        });
    }

    function bindHostControls(wrap) {
        if (wrap.getAttribute('data-dc-war-bound') === '1') {
            applyMetricsToCheckboxes(wrap);
            var sw = wrap.querySelector('select[data-dc-action-watch]');
            var wt = wrap.querySelector('input[data-dc-watch-toggle]');
            if (sw) {
                sw.value = readActionWatch();
            }
            renderIntervalRows(wrap);
            bindIntervalListControls(wrap);
            scheduleAdvancedFilterBottomPadding();
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
        applyMetricsToCheckboxes(wrap);
        if (selWatch) {
            selWatch.value = readActionWatch();
        }
        renderIntervalRows(wrap);
        bindIntervalListControls(wrap);
        scheduleAdvancedFilterBottomPadding();
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
                scheduleAdvancedFilterBottomPadding();
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
        if (anyIntervalRowOn(readIntervalRows())) {
            ensureIntervalReplaceRunning();
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
                scheduleAdvancedFilterBottomPadding();
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
        restoreAdvancedFilterBottomPadding();
        if (relocateRetryTimer) {
            clearInterval(relocateRetryTimer);
            relocateRetryTimer = null;
        }
        if (relocateRaf) {
            cancelAnimationFrame(relocateRaf);
            relocateRaf = 0;
        }
        if (filterPadRetryTimer) {
            clearInterval(filterPadRetryTimer);
            filterPadRetryTimer = null;
        }
        if (filterPadRaf) {
            cancelAnimationFrame(filterPadRaf);
            filterPadRaf = 0;
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
