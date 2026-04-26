// ==UserScript==
// @name         Alerts: send tails to worksheet
// @namespace    Wolf 2.0
// @version      0.4.2
// @description  /alerts: rules (AND/OR), tail or flight, auto on table change or timer. BroadcastChannel to worksheet. localStorage + modal; optional DonkeyCODE defaults.
// @match        https://opssuitemain.swacorp.com/alerts*
// @match        https://opssuitemain.swacorp.com/*/alerts*
// @grant        none
// @donkeycode-pref {"alertsTailsToWsLog":{"type":"boolean","group":"Alerts → WS (defaults)","label":"Debug log","default":false,"description":"These prefs seed the modal on first use; after that, the modal’s Save uses local storage."},"alertsTailsToWsListWaitMs":{"type":"number","group":"Alerts → WS (defaults)","label":"Worksheet list wait (ms)","default":2000,"min":100,"max":8000,"step":100},"alertsTailsToWsSendMode":{"type":"select","group":"Alerts → WS (defaults)","label":"Which rows (default)","default":"all_visible","options":[{"val":"all_visible","label":"All visible rows"},{"val":"checked_only","label":"Checked rows only"}]},"alertsTailsToWsDeduplicate":{"type":"boolean","group":"Alerts → WS (defaults)","label":"Deduplicate (default)","default":true},"alertsTailsToWsStaggerMs":{"type":"number","group":"Alerts → WS (defaults)","label":"Stagger ms (default)","default":150,"min":0,"max":2000,"step":50},"alertsTailsToWsAutoTable":{"type":"boolean","group":"Alerts → WS (defaults)","label":"Autorun on table change (default)","default":false,"description":"Seeds the modal. Saved config in local storage wins after first use."},"alertsTailsToWsAutoInterval":{"type":"number","group":"Alerts → WS (defaults)","label":"Autorun interval sec (0=off, default)","default":0,"min":0,"max":3600,"step":5,"description":"0 = no timer. Seeds the modal; local storage overrides after save."}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Alerts%20send%20tails%20to%20worksheet.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Alerts%20send%20tails%20to%20worksheet.user.js
// ==/UserScript==

(function () {
    'use strict';

    var BC_WS_NAME = 'dc_pax_late_to_ws_v1';
    var MOUNT_ID = 'dc-alerts-tails-ws-ui';
    var PICKER_ID = 'dc-alerts-ws-config';

    var LS_KEY = 'dc_alerts_ws_ui_config_v1';
    var CONFIG_V = 2;

    var ch = null;
    var mountTimer = 0;
    var mountObserver = null;
    var tableAutoObserver = null;
    var tableDebounceTid = 0;
    var intervalTid = 0;
    var lastTableSnap = '';
    var lastPlanHash = '';
    var cachedConfig = null;

    function getPref(k, d) {
        if (typeof donkeycodeGetPref !== 'function') {
            return d;
        }
        var v = donkeycodeGetPref(k);
        if (v === undefined || v === null || v === '') {
            return d;
        }
        return v;
    }

    function defaultConfigFromPrefs() {
        return {
            configVersion: CONFIG_V,
            sendMode: getPref('alertsTailsToWsSendMode', 'all_visible'),
            dedupe: getPref('alertsTailsToWsDeduplicate', true) !== false,
            staggerMs: Number(getPref('alertsTailsToWsStaggerMs', 150)) || 150,
            listWaitMs: Number(getPref('alertsTailsToWsListWaitMs', 2000)) || 2000,
            autoRunOnTableChange: getPref('alertsTailsToWsAutoTable', false) === true,
            autoRunIntervalSec: Math.max(0, Number(getPref('alertsTailsToWsAutoInterval', 0)) || 0),
            rules: []
        };
    }

    function loadConfig() {
        if (cachedConfig) {
            return cachedConfig;
        }
        var base = defaultConfigFromPrefs();
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (raw) {
                var o = JSON.parse(raw);
                if (o && typeof o === 'object') {
                    if (o.sendMode) {
                        base.sendMode = o.sendMode;
                    }
                    if (typeof o.dedupe === 'boolean') {
                        base.dedupe = o.dedupe;
                    }
                    if (o.staggerMs != null) {
                        base.staggerMs = Number(o.staggerMs);
                    }
                    if (o.listWaitMs != null) {
                        base.listWaitMs = Number(o.listWaitMs);
                    }
                    if (o.configVersion) {
                        base.configVersion = o.configVersion;
                    }
                    if (typeof o.autoRunOnTableChange === 'boolean') {
                        base.autoRunOnTableChange = o.autoRunOnTableChange;
                    }
                    if (o.autoRunIntervalSec != null) {
                        base.autoRunIntervalSec = Math.max(0, Number(o.autoRunIntervalSec)) || 0;
                    }
                    if (Array.isArray(o.rules)) {
                        base.rules = o.rules;
                    }
                }
            } else {
                try {
                    localStorage.setItem(LS_KEY, JSON.stringify(base));
                } catch (e) {}
            }
        } catch (e) {
        }
        cachedConfig = base;
        for (var mr = 0; mr < base.rules.length; mr++) {
            base.rules[mr] = migrateRuleV2(base.rules[mr]);
        }
        return base;
    }

    function newCondition() {
        return {
            id: 'c' + String(Date.now()) + String(Math.random()).slice(2, 6),
            matchField: 'alertType',
            matchText: '',
            matchMode: 'contains'
        };
    }

    function normalizeCondition(c) {
        if (!c || typeof c !== 'object') {
            c = {};
        }
        var mode = c.matchMode;
        if (mode !== 'contains' && mode !== 'regex' && mode !== 'exact') {
            mode = 'contains';
        }
        return {
            id: c.id || 'c' + String(Date.now()) + String(Math.random()).slice(2, 6),
            matchField: c.matchField || 'alertType',
            matchText: c.matchText != null ? String(c.matchText) : '',
            matchMode: mode
        };
    }

    function migrateRuleV2(r) {
        if (!r || typeof r !== 'object') {
            return r;
        }
        if (Array.isArray(r.conds) && r.conds.length) {
            r.combine = r.combine === 'or' ? 'or' : 'and';
            var j;
            for (j = 0; j < r.conds.length; j++) {
                r.conds[j] = normalizeCondition(r.conds[j]);
            }
            return r;
        }
        r.combine = 'and';
        r.conds = [
            normalizeCondition({
                matchField: r.matchField,
                matchText: r.matchText,
                matchMode: r.matchMode
            })
        ];
        return r;
    }

    function cloneForStorage(c) {
        if (!c) {
            return c;
        }
        var o = {
            configVersion: c.configVersion || CONFIG_V,
            sendMode: c.sendMode,
            dedupe: c.dedupe,
            staggerMs: c.staggerMs,
            listWaitMs: c.listWaitMs,
            autoRunOnTableChange: c.autoRunOnTableChange,
            autoRunIntervalSec: c.autoRunIntervalSec,
            rules: []
        };
        if (c.rules && c.rules.length) {
            for (var i = 0; i < c.rules.length; i++) {
                var r = c.rules[i];
                if (!r) {
                    continue;
                }
                r = migrateRuleV2(r);
                var st = { id: r.id, action: r.action, targetTabId: r.targetTabId, targetTitle: r.targetTitle, enabled: r.enabled, combine: r.combine === 'or' ? 'or' : 'and', conds: [] };
                var cc;
                for (cc = 0; cc < (r.conds || []).length; cc++) {
                    var cnd = r.conds[cc];
                    if (!cnd) {
                        continue;
                    }
                    st.conds.push({
                        id: cnd.id,
                        matchField: cnd.matchField,
                        matchText: cnd.matchText,
                        matchMode: cnd.matchMode
                    });
                }
                o.rules.push(st);
            }
        }
        return o;
    }

    function saveConfig(cfg) {
        var plain = cloneForStorage(cfg);
        cachedConfig = JSON.parse(JSON.stringify(plain));
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(plain));
        } catch (e) {}
    }

    function listWaitFromConfig() {
        var c = loadConfig();
        var n = Number(c.listWaitMs);
        if (!Number.isFinite(n)) {
            n = 2000;
        }
        return Math.min(8000, Math.max(100, Math.floor(n)));
    }

    function log() {
        if (getPref('alertsTailsToWsLog', false) === false) {
            return;
        }
        try {
            console.log.apply(
                console,
                ['%c[Alerts→WS]', 'color:#2ecc71'].concat([].slice.call(arguments))
            );
        } catch (e) {}
    }

    function randomId() {
        return String(Date.now()) + '-' + String(Math.random()).slice(2, 11);
    }

    function ensureChannel() {
        if (ch) {
            return ch;
        }
        if (typeof BroadcastChannel === 'undefined') {
            return null;
        }
        try {
            ch = new BroadcastChannel(BC_WS_NAME);
        } catch (e) {
            ch = null;
        }
        return ch;
    }

    function listWorksheetTabsOnce() {
        return new Promise(function (resolve) {
            var c = ensureChannel();
            if (!c) {
                resolve([]);
                return;
            }
            var listId = randomId();
            var seen = Object.create(null);
            var did = false;
            function finish() {
                if (did) {
                    return;
                }
                did = true;
                try {
                    c.removeEventListener('message', onMsg);
                } catch (e) {}
                try {
                    clearTimeout(to);
                } catch (e2) {}
                var out = [];
                var k;
                for (k in seen) {
                    if (Object.prototype.hasOwnProperty.call(seen, k)) {
                        out.push(seen[k]);
                    }
                }
                out.sort(function (a, b) {
                    return String(a.title).localeCompare(String(b.title));
                });
                resolve(out);
            }
            function onMsg(ev) {
                var d = ev && ev.data;
                if (!d || d.t !== 'ws_hello' || d.listId !== listId) {
                    return;
                }
                if (d.tabId) {
                    seen[d.tabId] = { tabId: d.tabId, title: d.title || d.tabId };
                }
            }
            c.addEventListener('message', onMsg);
            var to = setTimeout(finish, listWaitFromConfig());
            try {
                c.postMessage({ t: 'ws_list', listId: listId });
            } catch (e) {
                finish();
            }
        });
    }

    function listWorksheetTabs() {
        return listWorksheetTabsOnce().then(function (first) {
            if (first && first.length) {
                return first;
            }
            return new Promise(function (r) {
                setTimeout(function () {
                    listWorksheetTabsOnce().then(r);
                }, 400);
            });
        });
    }

    var RE_N_TAIL = /N\d{1,5}[A-Z0-9]?/gi;

    function normalizeTailToken(s) {
        if (!s) {
            return '';
        }
        s = String(s).replace(/\s+/g, '').trim();
        if (!s) {
            return '';
        }
        var m = s.match(/N[0-9]{1,5}[A-Z0-9]*/i);
        if (m) {
            return m[0].toUpperCase();
        }
        return '';
    }

    function cellByLabel(tr, label) {
        if (!tr) {
            return null;
        }
        var c =
            tr.querySelector('td[data-label="' + label + '"]') ||
            tr.querySelector('[data-label="' + label + '"]');
        if (c) {
            return c;
        }
        return null;
    }

    function tdByIndex(tr, zeroBased) {
        if (!tr) {
            return null;
        }
        var tds = tr.querySelectorAll('td');
        if (tds[zeroBased]) {
            return tds[zeroBased];
        }
        return null;
    }

    function rowText(tr) {
        return {
            alertType: textCell(cellByLabel(tr, 'Alert Type') || tdByIndex(tr, 2)),
            time: textCell(cellByLabel(tr, 'Time') || tdByIndex(tr, 3)),
            city: textCell(cellByLabel(tr, 'City') || tdByIndex(tr, 4)),
            tail: textCell(cellByLabel(tr, 'Tail #') || tdByIndex(tr, 5)),
            description: textCell(cellByLabel(tr, 'Description') || tdByIndex(tr, 6)),
            additional: textCell(cellByLabel(tr, 'Additional Info') || tdByIndex(tr, 7))
        };
    }

    function textCell(el) {
        if (!el) {
            return '';
        }
        return String(el.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function tailFromCellRaw(raw) {
        var found = null;
        RE_N_TAIL.lastIndex = 0;
        var m;
        while ((m = RE_N_TAIL.exec(raw)) !== null) {
            if (m[0] && /^N/i.test(m[0]) && m[0].length >= 4) {
                found = m[0].toUpperCase();
                break;
            }
        }
        if (found) {
            return found;
        }
        return normalizeTailToken(raw) || '';
    }

    function extractFlightNumbersFromText(s) {
        var t = String(s || '');
        var re = /(?:^|[^\d/])([1-9]\d{0,3})(?=$|[^\d.])/g;
        var out = [];
        var seen = Object.create(null);
        var m;
        while ((m = re.exec(t)) !== null) {
            var d = m[1];
            if (d.length === 4 && /^(19|20)\d{2}$/.test(d)) {
                continue;
            }
            if (d && !seen[d]) {
                seen[d] = 1;
                out.push(d);
            }
        }
        if (!out.length) {
            re = /\b([1-9]\d{0,3})\b/g;
            while ((m = re.exec(t)) !== null) {
                d = m[1];
                if (d.length === 4 && /^(19|20)\d{2}$/.test(d)) {
                    continue;
                }
                if (d && !seen[d]) {
                    seen[d] = 1;
                    out.push(d);
                }
            }
        }
        return out;
    }

    function rowCheckboxChecked(tr) {
        if (!tr || !tr.querySelector) {
            return false;
        }
        var box =
            tr.querySelector('td:nth-child(2) .checkbox input[type="checkbox"]') ||
            tr.querySelector('td .checkbox input[type="checkbox"]');
        return box && box.checked === true;
    }

    function getTableBody() {
        var tbody = document.querySelector('tbody[aria-label="anomaly-table-body"]');
        if (!tbody) {
            tbody = document.querySelector('table .ui.celled.table tbody');
        }
        return tbody;
    }

    function getRowsForMode(mode) {
        var tbody = getTableBody();
        if (!tbody) {
            return [];
        }
        var rows = [].slice.call(tbody.querySelectorAll('tr'));
        var out = [];
        var i;
        for (i = 0; i < rows.length; i++) {
            if (mode === 'checked_only' && !rowCheckboxChecked(rows[i])) {
                continue;
            }
            out.push(rows[i]);
        }
        return out;
    }

    function ruleMatchField(Row, field) {
        if (field === 'alertType') {
            return Row.alertType;
        }
        if (field === 'description') {
            return Row.description + ' ' + Row.additional;
        }
        if (field === 'city') {
            return Row.city;
        }
        return Row.alertType;
    }

    function matchOneCondition(Row, cnd) {
        if (!cnd || !String(cnd.matchText || '').trim()) {
            return false;
        }
        cnd = normalizeCondition(cnd);
        var hay = String(ruleMatchField(Row, cnd.matchField) || '');
        var needle = String(cnd.matchText || '');
        if (cnd.matchMode === 'regex') {
            try {
                return new RegExp(needle, 'i').test(hay);
            } catch (e) {
                return false;
            }
        }
        if (cnd.matchMode === 'exact') {
            return hay.toLowerCase() === needle.toLowerCase();
        }
        return hay.toLowerCase().indexOf(needle.toLowerCase()) >= 0;
    }

    function matchRule(Row, rule) {
        rule = migrateRuleV2(rule);
        if (!rule || !rule.conds || !rule.conds.length) {
            return false;
        }
        var active = (rule.conds || []).filter(function (c) {
            return c && String(normalizeCondition(c).matchText || '').trim();
        });
        if (!active.length) {
            return false;
        }
        var v;
        var u;
        var n = active.length;
        for (u = 0; u < n; u++) {
            v = matchOneCondition(Row, active[u]);
            if (rule.combine === 'or') {
                if (v) {
                    return true;
                }
            } else {
                if (!v) {
                    return false;
                }
            }
        }
        return rule.combine === 'or' ? false : true;
    }

    function newRule() {
        return {
            id: 'r' + String(Date.now()) + String(Math.random()).slice(2, 8),
            combine: 'and',
            conds: [ newCondition() ],
            action: 'tail',
            targetTabId: '',
            targetTitle: '',
            enabled: true
        };
    }

    function postApplyTail(tail, targetTabId) {
        var c = ensureChannel();
        if (!c) {
            return;
        }
        var id = randomId();
        var payload = {
            t: 'ws_apply_tail',
            id: id,
            tail: String(tail || '').trim().toUpperCase(),
            targetTabId: targetTabId
        };
        var k;
        for (k = 0; k < 4; k++) {
            try {
                c.postMessage(payload);
            } catch (e) {}
        }
        log('ws_apply_tail ' + payload.tail + ' → ' + targetTabId);
    }

    function postApplyFlights(flightDigits, targetTabId) {
        if (!flightDigits || !flightDigits.length) {
            return;
        }
        var c = ensureChannel();
        if (!c) {
            return;
        }
        var id = randomId();
        var flights = flightDigits.map(function (d) {
            return String(d).replace(/^\s+|\s+$/g, '');
        });
        var payload = {
            t: 'ws_apply',
            id: id,
            flights: flights,
            targetTabId: targetTabId
        };
        var k;
        for (k = 0; k < 3; k++) {
            try {
                c.postMessage(payload);
            } catch (e) {}
        }
        log('ws_apply flights ' + flights.join(',') + ' → ' + targetTabId);
    }

    function runStaggered(items, perItem, done) {
        var c = loadConfig();
        var stagger = Number(c.staggerMs);
        if (!Number.isFinite(stagger)) {
            stagger = 150;
        }
        stagger = Math.min(2000, Math.max(0, stagger));
        var i = 0;
        function next() {
            if (i >= items.length) {
                if (done) {
                    done();
                }
                return;
            }
            perItem(items[i], i);
            i++;
            if (i < items.length) {
                if (stagger > 0) {
                    setTimeout(next, stagger);
                } else {
                    next();
                }
            } else {
                if (done) {
                    setTimeout(done, 0);
                }
            }
        }
        if (!items.length && done) {
            done();
            return;
        }
        next();
    }

    function runSendPlan(plan) {
        var order = Object.keys(plan);
        if (!order.length) {
            return;
        }
        var bi = 0;
        function nextBucket() {
            if (bi >= order.length) {
                return;
            }
            var tabId = order[bi];
            var b = plan[tabId] || { tails: [], flights: [] };
            bi++;
            var seq = [];
            var t;
            for (t = 0; t < b.tails.length; t++) {
                seq.push({ k: 'tail', v: b.tails[t] });
            }
            for (t = 0; t < b.flights.length; t++) {
                seq.push({ k: 'f', v: b.flights[t] });
            }
            runStaggered(seq, function (x) {
                if (x.k === 'tail') {
                    postApplyTail(x.v, tabId);
                } else {
                    postApplyFlights([x.v], tabId);
                }
            }, nextBucket);
        }
        nextBucket();
    }

    function ruleIsReady(r) {
        r = migrateRuleV2(r);
        if (!r || r.enabled === false) {
            return false;
        }
        if (!String(r.targetTabId || '').trim()) {
            return false;
        }
        if (!r.conds || !r.conds.length) {
            return false;
        }
        for (var i = 0; i < r.conds.length; i++) {
            if (String(normalizeCondition(r.conds[i]).matchText || '').trim()) {
                return true;
            }
        }
        return false;
    }

    function buildPlanFromTable(cfg) {
        var rows = getRowsForMode(cfg.sendMode);
        var rules = (cfg.rules || []).filter(function (r) { return ruleIsReady(r); });
        var plan = Object.create(null);
        var r;
        var i;
        var j;

        for (i = 0; i < rows.length; i++) {
            var R = rowText(rows[i]);
            for (j = 0; j < rules.length; j++) {
                r = migrateRuleV2(rules[j]);
                if (!matchRule(R, r)) {
                    continue;
                }
                var tid = String(r.targetTabId).trim();
                if (!plan[tid]) {
                    plan[tid] = { tails: [], flights: [] };
                }
                if (r.action === 'flight') {
                    var fromDesc = extractFlightNumbersFromText(
                        R.description + ' ' + R.additional
                    );
                    if (R.alertType) {
                        fromDesc = fromDesc.concat(
                            extractFlightNumbersFromText(R.alertType)
                        );
                    }
                    if (cfg.dedupe) {
                        var sF = Object.create(null);
                        var f;
                        for (f = 0; f < fromDesc.length; f++) {
                            if (!sF[fromDesc[f]]) {
                                sF[fromDesc[f]] = 1;
                                plan[tid].flights.push(fromDesc[f]);
                            }
                        }
                    } else {
                        plan[tid].flights = plan[tid].flights.concat(fromDesc);
                    }
                } else {
                    var tw = tailFromCellRaw(R.tail);
                    if (tw) {
                        if (cfg.dedupe) {
                            if (plan[tid].tails.indexOf(tw) < 0) {
                                plan[tid].tails.push(tw);
                            }
                        } else {
                            plan[tid].tails.push(tw);
                        }
                    }
                }
                break;
            }
        }
        if (cfg.dedupe) {
            var wtid;
            for (wtid in plan) {
                if (!Object.prototype.hasOwnProperty.call(plan, wtid)) {
                    continue;
                }
                var tSeen = Object.create(null);
                var tList = plan[wtid].tails;
                var tList2 = [];
                for (j = 0; j < tList.length; j++) {
                    if (!tSeen[tList[j]]) {
                        tSeen[tList[j]] = 1;
                        tList2.push(tList[j]);
                    }
                }
                plan[wtid].tails = tList2;
            }
        }
        return plan;
    }

    function countPlan(p) {
        var nT = 0;
        var nF = 0;
        var k;
        for (k in p) {
            if (Object.prototype.hasOwnProperty.call(p, k) && p[k]) {
                nT += (p[k].tails && p[k].tails.length) || 0;
                nF += (p[k].flights && p[k].flights.length) || 0;
            }
        }
        return nT + nF;
    }

    function planCanonicalHash(plan) {
        var keys = Object.keys(plan || {}).sort();
        var parts = [];
        var ki;
        for (ki = 0; ki < keys.length; ki++) {
            var tabId = keys[ki];
            var b = plan[tabId];
            if (!b) {
                continue;
            }
            var ts = (b.tails || []).slice().sort().join(',');
            var fs = (b.flights || []).slice().sort().join(',');
            parts.push(tabId + ':T[' + ts + ']F[' + fs + ']');
        }
        return parts.join('|');
    }

    function maybeAutoRun(reason) {
        var cfg = loadConfig();
        var hasWatch =
            cfg.autoRunOnTableChange === true ||
            (Number(cfg.autoRunIntervalSec) > 0);
        if (!hasWatch) {
            return;
        }
        if (!ensureChannel()) {
            return;
        }
        if (!cfg.rules || !cfg.rules.length) {
            return;
        }
        if (!cfg.rules.some(function (r) { return r && r.enabled && String(r.targetTabId || '').trim(); })) {
            return;
        }
        var plan = buildPlanFromTable(cfg);
        var h = planCanonicalHash(plan);
        if (h === lastPlanHash) {
            log('auto skip (no plan change) ' + (reason || ''));
            return;
        }
        if (!countPlan(plan)) {
            lastPlanHash = h;
            log('auto skip (empty plan) ' + (reason || ''));
            return;
        }
        lastPlanHash = h;
        log('auto run ' + (reason || '') + ' → ' + h);
        runSendPlan(plan);
    }

    var TABLE_OBS_DEBOUNCE_MS = 400;

    function clearTableAutoWatch() {
        if (tableDebounceTid) {
            try {
                clearTimeout(tableDebounceTid);
            } catch (e) {}
            tableDebounceTid = 0;
        }
        if (tableAutoObserver) {
            try {
                tableAutoObserver.disconnect();
            } catch (e2) {}
            tableAutoObserver = null;
        }
    }

    function clearIntervalAutoWatch() {
        if (intervalTid) {
            try {
                clearInterval(intervalTid);
            } catch (e) {}
            intervalTid = 0;
        }
    }

    function scheduleTableSnapshotMaybe() {
        var tbody = getTableBody();
        if (!tbody) {
            return;
        }
        var s = '';
        try {
            s = tbody.innerText || '';
        } catch (e) {
            s = '';
        }
        if (s === lastTableSnap) {
            return;
        }
        lastTableSnap = s;
        maybeAutoRun('table');
    }

    function scheduleAutoRunRefresh() {
        var cfg = loadConfig();
        clearTableAutoWatch();
        clearIntervalAutoWatch();
        lastTableSnap = '';
        lastPlanHash = '';

        if (cfg.autoRunOnTableChange) {
            var tb = getTableBody();
            if (tb) {
                try {
                    lastTableSnap = tb.innerText || '';
                } catch (e) {}
            }
            try {
                tableAutoObserver = new MutationObserver(function () {
                    if (tableDebounceTid) {
                        try {
                            clearTimeout(tableDebounceTid);
                        } catch (e2) {}
                    }
                    tableDebounceTid = setTimeout(function () {
                        tableDebounceTid = 0;
                        try {
                            scheduleTableSnapshotMaybe();
                        } catch (e3) {}
                    }, TABLE_OBS_DEBOUNCE_MS);
                });
                var root = getTableBody() || document.body;
                tableAutoObserver.observe(root, { childList: true, subtree: true, characterData: true });
            } catch (e4) {
                tableAutoObserver = null;
            }
        }

        var sec = Math.max(0, Math.floor(Number(cfg.autoRunIntervalSec) || 0));
        if (sec > 0) {
            intervalTid = setInterval(function () {
                try {
                    maybeAutoRun('timer');
                } catch (e5) {}
            }, sec * 1000);
        }
    }

    function closePicker() {
        var p = document.getElementById(PICKER_ID);
        if (p) {
            try {
                p.remove();
            } catch (e) {}
        }
    }

    function el(tag, text, st) {
        var e = document.createElement(tag);
        if (text) {
            e.textContent = text;
        }
        if (st) {
            e.style.cssText = st;
        }
        return e;
    }

    function showConfigModal() {
        try {
        closePicker();
        var cfg = JSON.parse(JSON.stringify(loadConfig()));
        if (!Array.isArray(cfg.rules)) {
            cfg.rules = [];
        }

        var backdrop = el(
            'div',
            null,
            'position:fixed!important;inset:0!important;z-index:10000050!important;background:rgba(0,0,0,.55)!important;' +
                'display:flex!important;align-items:center!important;justify-content:center!important;padding:12px!important;' +
                'box-sizing:border-box!important;'
        );
        backdrop.setAttribute('data-dc-alerts-ws-backdrop', '1');
        backdrop.id = PICKER_ID;
        var panel = el(
            'div',
            null,
            'position:relative!important;z-index:1!important;align-self:center!important;box-sizing:border-box!important;' +
                'background:#1a1f24!important;color:#e8ecef!important;border-radius:10px!important;width:min(640px, 96vw)!important;' +
                'min-width: min(300px, 96vw) !important;min-height: 220px !important;max-height: 92vh !important;overflow: hidden !important;' +
                'display:flex !important;flex-direction: column !important; flex: 0 0 auto !important; ' +
                'box-shadow:0 16px 48px rgba(0,0,0,.5)!important;border:1px solid #3d4a56!important;font:14px/1.45 system-ui,Segoe UI,sans-serif!important;'
        );

        var head = el(
            'div',
            'Auto send to worksheet',
            'font:600 16px system-ui,sans-serif!important;padding:12px 16px!important;border-bottom:1px solid #334155!important;'
        );
        var sc = el(
            'div',
            null,
            'box-sizing: border-box !important; flex: 0 1 auto !important; ' +
            'min-height: 0 !important; ' +
            'max-height: min(58vh, 480px) !important; ' +
            'overflow-y: auto !important; overflow-x: hidden !important; ' +
            'padding: 12px 16px !important; display: flex !important; flex-direction: column !important; gap: 14px !important; ' +
            '-webkit-overflow-scrolling: touch;'
        );

        var h2 = el(
            'div',
            'Table',
            'font:600 13px system-ui!important;color:#94a3b8!important;text-transform:uppercase;letter-spacing:.04em;'
        );
        sc.appendChild(h2);
        var row1 = el('div', null, 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;');
        row1.appendChild(
            (function () {
                var w = el('label', 'Rows: ');
                var sel = document.createElement('select');
                sel.style.cssText = 'max-width:220px;padding:4px 8px;border-radius:4px;';
                sel.innerHTML =
                    '<option value="all_visible">All visible rows</option><option value="checked_only">Checked only</option>';
                sel.value = cfg.sendMode === 'checked_only' ? 'checked_only' : 'all_visible';
                w.appendChild(sel);
                sc._fSendMode = sel;
                return w;
            })()
        );
        row1.appendChild(
            (function () {
                var w = el('label', null, 'display:flex;align-items:center;gap:6px;');
                w.appendChild(
                    (function () {
                        var c = document.createElement('input');
                        c.type = 'checkbox';
                        c.checked = cfg.dedupe !== false;
                        sc._fDedupe = c;
                        return c;
                    })()
                );
                w.appendChild(
                    el(
                        'span',
                        'Dedupe',
                        null
                    )
                );
                w.title = 'In one “Run” or auto pass, each tail and each flight # is only sent once per destination worksheet (no duplicate lines for the same value).';
                return w;
            })()
        );
        sc.appendChild(row1);
        var row2 = el('div', null, 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;');
        row2.appendChild(
            (function () {
                var w = el('label', 'Stagger (ms): ');
                var inS = document.createElement('input');
                inS.type = 'number';
                inS.min = 0;
                inS.max = 2000;
                inS.value = String(cfg.staggerMs != null ? cfg.staggerMs : 150);
                inS.style.cssText = 'width:70px;padding:4px;';
                sc._fStagger = inS;
                w.appendChild(inS);
                return w;
            })()
        );
        row2.appendChild(
            (function () {
                var w = el('label', 'List wait (ms): ');
                var inL = document.createElement('input');
                inL.type = 'number';
                inL.min = 100;
                inL.max = 8000;
                inL.value = String(cfg.listWaitMs != null ? cfg.listWaitMs : 2000);
                inL.style.cssText = 'width:80px;padding:4px;';
                sc._fListWait = inL;
                w.appendChild(inL);
                return w;
            })()
        );
        sc.appendChild(row2);
        var autoRow = el('div', null, 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;');
        var cbTable = document.createElement('input');
        cbTable.type = 'checkbox';
        cbTable.checked = cfg.autoRunOnTableChange === true;
        sc._fAutoTable = cbTable;
        var lTab = el('label', null, 'display:flex;align-items:center;gap:6px;cursor:pointer;');
        lTab.appendChild(cbTable);
        lTab.appendChild(
            el(
                'span',
                'When the alerts table updates',
                'font:12px;color:#e2e8f0;'
            )
        );
        lTab.title = 'Uses a short debounce after the table DOM or text changes.';
        autoRow.appendChild(lTab);
        autoRow.appendChild(
            (function () {
                var w = el('label', 'or every ', 'display:flex;align-items:center;gap:4px;');
                var inI = document.createElement('input');
                inI.type = 'number';
                inI.min = 0;
                inI.max = 3600;
                inI.value = String(
                    cfg.autoRunIntervalSec != null
                        ? Math.max(0, Math.floor(cfg.autoRunIntervalSec))
                        : 0
                );
                inI.style.cssText = 'width:56px;padding:4px;';
                sc._fAutoInterval = inI;
                w.appendChild(inI);
                w.appendChild(el('span', 's', 'font:12px;'));
                w.appendChild(
                    el(
                        'span',
                        '(0 = off)',
                        'font:11px!important;color:#64748b!important;margin-left:4px;'
                    )
                );
                w.title = 'Re-evaluates rules on this interval. Independent of table updates.';
                return w;
            })()
        );
        sc.appendChild(autoRow);
        var helpAuto = el(
            'div',
            null,
            'font:12px!important;color:#7d8a97!important;margin:0!important;line-height:1.5!important;'
        );
        helpAuto.appendChild(
            el(
                'p',
                'Autorun (table + timer): the script builds a send plan from the visible table. For each row, the first enabled rule that matches decides whether to send that row’s tail or flight numbers to that rule’s worksheet. Autorun runs when the table’s content changes (debounced) and/or on the interval you set.',
                'margin:0 0 8px 0!important;'
            )
        );
        helpAuto.appendChild(
            el(
                'p',
                'No repeat sends on a steady table: after a send, the same set of tails and flights per worksheet is not posted again until the plan actually changes (rows update, filters change, or rules match differently). Run now also updates that state.',
                'margin:0 0 8px 0!important;'
            )
        );
        helpAuto.appendChild(
            el(
                'p',
                'Match lines: add one or more; combine with all of (AND) or any of (OR). Contains = substring. Exact = whole field, case-insensitive. Regex = pattern (e.g. Misrouted.*HGR); invalid patterns never match.',
                'margin:0 0 8px 0!important;'
            )
        );
        helpAuto.appendChild(
            el(
                'p',
                'Dedupe: in one run, each tail and each flight # is only queued once per destination worksheet. Stagger delays separate posts. Save writes this browser’s copy (local storage) and restarts autorun if enabled.',
                'margin:0!important;'
            )
        );
        sc.appendChild(helpAuto);

        var hRules = el(
            'div',
            'Rules',
            'font:600 13px system-ui!important;color:#94a3b8!important;text-transform:uppercase;letter-spacing:.04em;'
        );
        sc.appendChild(hRules);
        var rulesBox = el('div', null, 'display:flex;flex-direction:column;gap:8px;');
        sc._rulesBox = rulesBox;
        sc.appendChild(rulesBox);

        var btnAdd = el('button', '+ Add rule', 'align-self:flex-start;');
        btnAdd.type = 'button';
        btnAdd.style.cssText =
            'font:12px system-ui;padding:4px 10px;border-radius:4px;cursor:pointer;background:#24303d;color:#e2e8f0;border:1px solid #3d4a56;';
        sc._btnAdd = btnAdd;
        sc._wsTabs = null;
        sc.appendChild(btnAdd);

        var summary = el(
            'div',
            'Load worksheets…',
            'font:12px!important;padding:6px 0!important;color:#94a3b8!important;'
        );
        sc._summary = summary;
        sc.appendChild(summary);

        var foot = el(
            'div',
            null,
            'box-sizing: border-box !important; flex: 0 0 auto !important; ' +
            'display: flex !important; flex-wrap: wrap !important; gap: 8px !important; justify-content: flex-end !important; ' +
            'padding: 10px 14px !important; border-top: 1px solid #334155 !important; ' +
            'background: #14191e !important;'
        );
        var btnRun = el('button', 'Run now', null);
        btnRun.type = 'button';
        btnRun.style.cssText =
            'font:13px system-ui;padding:6px 14px;border-radius:5px;cursor:pointer;background:#1a5270;color:#ecf0f1;border:1px solid #334155;';
        var btnSave = el('button', 'Save', null);
        btnSave.type = 'button';
        btnSave.title = 'Save to this browser (localStorage ' + LS_KEY + ')';
        btnSave.style.cssText =
            'font:13px system-ui;padding:6px 14px;border-radius:5px;cursor:pointer;background:#2c5282;color:#ecf0f1;border:1px solid #334155;';
        var btnClose = el('button', 'Close', null);
        btnClose.type = 'button';
        btnClose.style.cssText =
            'font:13px system-ui;padding:6px 12px;border-radius:5px;cursor:pointer;background:#2d3748;color:#e2e8f0;border:1px solid #4a5568;';
        foot.appendChild(btnRun);
        foot.appendChild(btnSave);
        foot.appendChild(btnClose);
        panel.appendChild(head);
        panel.appendChild(sc);
        panel.appendChild(foot);
        try {
            backdrop.appendChild(panel);
        } catch (eAp) {
            throw eAp;
        }
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) {
                closePicker();
            }
        });
        panel.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        document.body.appendChild(backdrop);

        function readFormIntoCfg() {
            cfg.sendMode = sc._fSendMode && sc._fSendMode.value === 'checked_only'
                ? 'checked_only'
                : 'all_visible';
            cfg.dedupe = !!(sc._fDedupe && sc._fDedupe.checked);
            var st = sc._fStagger ? Number(sc._fStagger.value) : 150;
            cfg.staggerMs = Number.isFinite(st) ? Math.min(2000, Math.max(0, st)) : 150;
            var lw = sc._fListWait ? Number(sc._fListWait.value) : 2000;
            cfg.listWaitMs = Number.isFinite(lw) ? Math.min(8000, Math.max(100, lw)) : 2000;
            cfg.configVersion = CONFIG_V;
            cfg.autoRunOnTableChange = !!(sc._fAutoTable && sc._fAutoTable.checked);
            var asec = sc._fAutoInterval ? Math.floor(Number(sc._fAutoInterval.value)) : 0;
            cfg.autoRunIntervalSec = Number.isFinite(asec) && asec > 0 ? Math.min(3600, asec) : 0;
            return cfg;
        }

        function renderWorksheetSelect(rule, tabOptions) {
            var fTgt = document.createElement('select');
            fTgt.style.cssText = 'min-width:200px;max-width:100%;font:12px;';
            var o0 = document.createElement('option');
            o0.value = '';
            o0.textContent = '— pick worksheet —';
            fTgt.appendChild(o0);
            if (tabOptions) {
                var t;
                for (t = 0; t < tabOptions.length; t++) {
                    var o = document.createElement('option');
                    o.value = tabOptions[t].tabId;
                    o.textContent = tabOptions[t].title || tabOptions[t].tabId;
                    if (String(o.value) === String(rule.targetTabId)) {
                        o.selected = true;
                    }
                    fTgt.appendChild(o);
                }
            }
            if (rule.targetTabId && fTgt && !fTgt.value) {
                fTgt.appendChild(
                    (function () {
                        var o = document.createElement('option');
                        o.value = String(rule.targetTabId);
                        o.textContent = String(rule.targetTitle || rule.targetTabId);
                        o.selected = true;
                        return o;
                    })()
                );
            }
            return fTgt;
        }

        function renderRuleRow(rule, tabOptions) {
            rule = migrateRuleV2(rule);
            if (!Array.isArray(rule.conds) || !rule.conds.length) {
                rule.conds = [ newCondition() ];
            }
            var wrap = el('div', null, 'border:1px solid #3d4a56;border-radius:6px;padding:8px;background:#12171c;');
            var top = el('div', null, 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;');
            var en = document.createElement('input');
            en.type = 'checkbox';
            en.checked = rule.enabled !== false;
            en.title = 'Enabled';
            var labEn = el('span', 'On', 'font:12px;color:#94a3b8;');
            top.appendChild(en);
            top.appendChild(labEn);
            var fAct = document.createElement('select');
            fAct.style.cssText = 'font:12px;';
            fAct.innerHTML =
                '<option value="tail">Send tail</option><option value="flight">Send flight #</option>';
            fAct.value = rule.action === 'flight' ? 'flight' : 'tail';
            var fTgt = renderWorksheetSelect(rule, tabOptions);
            var btnDel = el('button', '×', 'padding:2px 8px;font:14px;cursor:pointer;');
            btnDel.type = 'button';
            btnDel.title = 'Remove rule';
            top.appendChild(fAct);
            top.appendChild(fTgt);
            top.appendChild(btnDel);
            wrap.appendChild(top);

            var cRow = el('div', null, 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px;');
            cRow.appendChild(
                el(
                    'span',
                    'If',
                    'font:12px;color:#94a3b8;'
                )
            );
            var fComb = document.createElement('select');
            fComb.style.cssText = 'font:12px;';
            fComb.title = 'How to combine the conditions on this row';
            fComb.innerHTML =
                '<option value="and">all of (AND)</option><option value="or">any of (OR)</option>';
            fComb.value = rule.combine === 'or' ? 'or' : 'and';
            cRow.appendChild(fComb);
            cRow.appendChild(
                el(
                    'span',
                    'of the following are true…',
                    'font:12px;color:#7d8a97;'
                )
            );
            var btnAddC = el('button', '+ line', 'font:11px;padding:2px 6px;cursor:pointer;margin-left:auto;');
            btnAddC.type = 'button';
            btnAddC.title = 'Add another match line';
            cRow.appendChild(btnAddC);
            wrap.appendChild(cRow);

            var condBox = el('div', null, 'display:flex;flex-direction:column;gap:4px;');
            wrap.appendChild(condBox);

            var condEls = [];

            function makeCondRow(cnd) {
                cnd = normalizeCondition(cnd);
                var row2 = el('div', null, 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;');
                var fMatch = document.createElement('select');
                fMatch.style.cssText = 'max-width:130px;font:12px system-ui;';
                fMatch.innerHTML =
                    '<option value="alertType">Alert type</option><option value="description">Description+info</option><option value="city">City</option>';
                fMatch.value = cnd.matchField || 'alertType';
                var fMode = document.createElement('select');
                fMode.style.cssText = 'font:12px;min-width:88px;';
                fMode.title =
                    'Contains = text anywhere; exact = full field; regex = pattern (e.g. Misrouted.*HGR).';
                fMode.innerHTML =
                    '<option value="contains">contains</option><option value="exact">exact</option><option value="regex">regex</option>';
                fMode.value = cnd.matchMode === 'regex' || cnd.matchMode === 'exact' ? cnd.matchMode : 'contains';
                var inp = document.createElement('input');
                inp.type = 'text';
                inp.placeholder = cnd.matchMode === 'regex' ? 'pattern…' : (cnd.matchMode === 'exact' ? 'exact value…' : 'contains…');
                inp.value = String(cnd.matchText || '');
                inp.style.cssText = 'flex:1;min-width:100px;padding:4px 8px;font:12px system-ui;border-radius:4px;';
                var rBtn = el('button', '–', 'padding:2px 6px;font:12px;cursor:pointer;min-width:28px;');
                rBtn.type = 'button';
                rBtn.title = 'Remove this line';
                row2.appendChild(fMatch);
                row2.appendChild(fMode);
                row2.appendChild(inp);
                row2.appendChild(rBtn);
                fMode.addEventListener('change', function () {
                    inp.placeholder =
                        fMode.value === 'regex' ? 'pattern…' : (fMode.value === 'exact' ? 'exact value…' : 'contains…');
                });
                rBtn.addEventListener('click', function () {
                    if (rule.conds.length < 2) {
                        return;
                    }
                    rule.conds = rule.conds.filter(function (x) { return x && x.id !== cnd.id; });
                    try {
                        row2.remove();
                    } catch (e) {}
                    condEls = condEls.filter(function (ce) { return ce.cndId !== cnd.id; });
                });
                return { row2: row2, fMatch: fMatch, fMode: fMode, inp: inp, cndId: cnd.id };
            }

            var c;
            for (c = 0; c < rule.conds.length; c++) {
                var rline = makeCondRow(rule.conds[c]);
                condEls.push(rline);
                condBox.appendChild(rline.row2);
            }

            btnAddC.addEventListener('click', function () {
                var nc = newCondition();
                rule.conds.push(nc);
                var nr = makeCondRow(nc);
                condEls.push(nr);
                condBox.appendChild(nr.row2);
            });

            rule._u = { en: en, fAct: fAct, fTgt: fTgt, fComb: fComb, condEls: condEls, rule: rule };
            btnDel.addEventListener('click', function () {
                cfg.rules = cfg.rules.filter(function (r) { return r.id !== rule.id; });
                try {
                    wrap.remove();
                } catch (e) {}
            });
            return wrap;
        }

        function syncRulesFromDom() {
            var next = [];
            if (!cfg.rules || !cfg.rules.length) {
                return;
            }
            for (var z = 0; z < cfg.rules.length; z++) {
                var u = cfg.rules[z]._u;
                if (!u) {
                    next.push(migrateRuleV2(cfg.rules[z]));
                    continue;
                }
                var rr = u.rule || cfg.rules[z];
                var conds = [];
                var e;
                for (e = 0; e < (u.condEls || []).length; e++) {
                    var elx = u.condEls[e];
                    if (!elx) {
                        continue;
                    }
                    var cm = elx.fMode && elx.fMode.value;
                    if (cm !== 'contains' && cm !== 'regex' && cm !== 'exact') {
                        cm = 'contains';
                    }
                    conds.push(
                        normalizeCondition({
                            id: elx.cndId,
                            matchField: elx.fMatch && elx.fMatch.value
                                ? elx.fMatch.value
                                : 'alertType',
                            matchText: (elx.inp && elx.inp.value) || '',
                            matchMode: cm
                        })
                    );
                }
                if (!conds.length) {
                    conds.push(newCondition());
                }
                next.push({
                    id: rr.id,
                    combine: u.fComb && u.fComb.value === 'or' ? 'or' : 'and',
                    conds: conds,
                    action: u.fAct && u.fAct.value === 'flight' ? 'flight' : 'tail',
                    targetTabId: u.fTgt && u.fTgt.value ? u.fTgt.value : '',
                    targetTitle: u.fTgt && u.fTgt.selectedIndex >= 0
                        ? (u.fTgt.options[u.fTgt.selectedIndex] &&
                            u.fTgt.options[u.fTgt.selectedIndex].textContent) || ''
                        : '',
                    enabled: u.en && u.en.checked
                });
            }
            cfg.rules = next;
        }

        function redrawRules(tabs) {
            rulesBox.innerHTML = '';
            for (var i = 0; i < cfg.rules.length; i++) {
                rulesBox.appendChild(renderRuleRow(cfg.rules[i], tabs));
            }
        }

        function setAddRuleBusy(busy) {
            if (!btnAdd) {
                return;
            }
            if (busy) {
                btnAdd.setAttribute('disabled', 'disabled');
                btnAdd.setAttribute('data-dc-adding', '1');
                btnAdd.style.opacity = '0.55';
                btnAdd.style.cursor = 'not-allowed';
            } else {
                try {
                    btnAdd.removeAttribute('disabled');
                } catch (e) {}
                btnAdd.removeAttribute('data-dc-adding');
                btnAdd.style.opacity = '';
                btnAdd.style.cursor = '';
            }
        }

        btnAdd.addEventListener('click', function () {
            if (btnAdd.getAttribute('data-dc-adding') === '1') {
                return;
            }
            readFormIntoCfg();
            try {
                syncRulesFromDom();
            } catch (e) {}
            var nr = newRule();
            if (!Array.isArray(cfg.rules)) {
                cfg.rules = [];
            }
            cfg.rules.push(nr);
            if (sc._wsTabs && sc._wsTabs.length) {
                redrawRules(sc._wsTabs);
                if (sc._summary) {
                    sc._summary.textContent =
                        'Rules: ' + cfg.rules.length + ' · ' + sc._wsTabs.length + ' worksheet(s). Use Run now, or turn on autorun above.';
                }
                return;
            }
            setAddRuleBusy(true);
            listWorksheetTabs()
                .then(function (tabs) {
                    sc._wsTabs = tabs || [];
                    redrawRules(sc._wsTabs);
                    if (sc._summary) {
                        sc._summary.textContent =
                            'Rules: ' + cfg.rules.length + ' · ' + (sc._wsTabs.length ? (sc._wsTabs.length + ' worksheet(s) in browser') : 'No worksheet tabs') + ' — Run now or use autorun if enabled.';
                    }
                })
                .catch(function () {
                })
                .then(function () {
                    setAddRuleBusy(false);
                });
        });

        listWorksheetTabs().then(function (tabs) {
            sc._wsTabs = tabs || [];
            if (cfg.rules.length) {
                redrawRules(sc._wsTabs);
            }
            if (!cfg.rules.length) {
                sc._summary.textContent =
                    'No rules yet. Add a rule, pick a worksheet, and e.g. match alert type. Use Run now, or enable “When the alerts table updates” / a timer above.';
            } else {
                sc._summary.textContent = 'Rules: ' + cfg.rules.length + ' · ' + (sc._wsTabs && sc._wsTabs.length ? (sc._wsTabs.length + ' worksheet(s) in this browser') : 'No worksheet tabs (open a worksheet in this browser).') + ' — Run now or autorun.';
            }
        });

        function saveForm() {
            readFormIntoCfg();
            try {
                syncRulesFromDom();
            } catch (e) {
            }
            saveConfig(cfg);
            try {
                scheduleAutoRunRefresh();
            } catch (e) {}
            if (getPref('alertsTailsToWsLog', false)) {
                try {
                    console.log('[Alerts→WS] saved', cfg);
                } catch (e) {}
            }
        }

        function runNow() {
            readFormIntoCfg();
            try {
                syncRulesFromDom();
            } catch (e) {
            }
            saveConfig(cfg);
            try {
                scheduleAutoRunRefresh();
            } catch (e2) {}
            if (!cfg.rules || !cfg.rules.length) {
                try {
                    window.alert('Add at least one rule with a worksheet and at least one match line with text.');
                } catch (e) {}
                return;
            }
            if (!cfg.rules.some(function (r) { return ruleIsReady(r); })) {
                try {
                    window.alert('Enable at least one rule, choose a worksheet, and enter match text on at least one line.');
                } catch (e) {}
                return;
            }
            if (!ensureChannel()) {
                try {
                    window.alert('BroadcastChannel not available.');
                } catch (e) {}
                return;
            }
            var plan = buildPlanFromTable(cfg);
            var n = countPlan(plan);
            if (!n) {
                try {
                    window.alert('No rows matched your rules, or no tails / flight #s could be read.');
                } catch (e) {}
                return;
            }
            lastPlanHash = planCanonicalHash(plan);
            log('plan: ' + JSON.stringify(plan));
            runSendPlan(plan);
            try {
                closePicker();
            } catch (e) {}
            try {
                window.alert('Sent ' + n + ' value(s) to worksheet(s) (see console if debug is on).');
            } catch (e) {}
        }

        btnSave.addEventListener('click', function () { saveForm(); });
        btnRun.addEventListener('click', function () { runNow(); });
        btnClose.addEventListener('click', function () { closePicker(); });
        } catch (err) {
            try {
                closePicker();
            } catch (e2) {}
            try {
                window.alert('Alerts auto-send: could not open dialog — ' + (err && err.message ? err.message : err));
            } catch (e3) {}
        }
    }

    function onOpenClick() {
        if (!ensureChannel()) {
            try {
                window.alert('BroadcastChannel is not available in this browser.');
            } catch (e) {}
            return;
        }
        showConfigModal();
    }

    function mountIfNeeded() {
        if (document.getElementById(MOUNT_ID)) {
            return;
        }
        var pre = document.querySelector('[data-testid="alerts-preheat-toggle"]');
        if (!pre) {
            return;
        }
        var row = pre.closest('div.vEuf4OudPJEFpDZYr4wX');
        if (!row) {
            row =
                pre.closest('div.field') && pre.closest('div.field').parentNode;
        }
        if (!row) {
            row = pre.parentNode && pre.parentNode.parentNode;
        }
        if (!row) {
            return;
        }
        var wrap = document.createElement('div');
        wrap.id = MOUNT_ID;
        wrap.className = 'field dtdZdbLbjSdDEZuktvkA';
        wrap.style.cssText = 'width:100%!important;';
        var inner = document.createElement('div');
        inner.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'auto send config';
        btn.setAttribute('aria-label', 'Open auto send to worksheet config');
        btn.title = 'Configure rules and run';
        btn.style.cssText =
            'font:600 11px system-ui,Segoe UI,sans-serif!important;border:none!important;border-radius:4px!important;' +
            'background:#1e3a4f!important;color:#ecf0f1!important;padding:4px 8px!important;cursor:pointer!important;' +
            'line-height:1.2!important;';
        bindButtonActivate2(btn, onOpenClick);
        inner.appendChild(btn);
        wrap.appendChild(inner);
        var phField = pre.closest('div.field');
        if (phField && phField.parentNode === row) {
            if (phField.nextSibling) {
                row.insertBefore(wrap, phField.nextSibling);
            } else {
                row.appendChild(wrap);
            }
        } else {
            try {
                row.appendChild(wrap);
            } catch (e) {
                pre.parentNode.appendChild(wrap);
            }
        }
    }

    function bindButtonActivate2(el, run) {
        if (!el || el.getAttribute('data-dc-act') === '1') {
            return;
        }
        el.setAttribute('data-dc-act', '1');
        var didPointer = false;
        el.addEventListener(
            'pointerup',
            function (ev) {
                if (!ev || ev.isTrusted === false) {
                    return;
                }
                if (ev.button != null && ev.button !== 0) {
                    return;
                }
                didPointer = true;
                setTimeout(function () {
                    didPointer = false;
                }, 600);
                try {
                    if (ev.preventDefault) {
                        ev.preventDefault();
                    }
                    if (ev.stopPropagation) {
                        ev.stopPropagation();
                    }
                } catch (e) {}
                try {
                    run();
                } catch (e2) {}
            },
            true
        );
        el.addEventListener(
            'click',
            function (ev) {
                if (didPointer) {
                    try {
                        if (ev.preventDefault) {
                            ev.preventDefault();
                        }
                        if (ev.stopPropagation) {
                            ev.stopPropagation();
                        }
                    } catch (e) {}
                }
            },
            true
        );
    }

    function scheduleMount() {
        if (mountTimer) {
            return;
        }
        mountTimer = setTimeout(function () {
            mountTimer = 0;
            try {
                mountIfNeeded();
            } catch (e) {}
        }, 0);
    }

    function start() {
        loadConfig();
        ensureChannel();
        try {
            scheduleAutoRunRefresh();
        } catch (e) {}
        scheduleMount();
        if (mountObserver) {
            return;
        }
        try {
            mountObserver = new MutationObserver(scheduleMount);
            mountObserver.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        } catch (e) {
            mountObserver = null;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
    setTimeout(scheduleMount, 1000);
    setTimeout(scheduleMount, 3000);

    window.__myScriptCleanup = function () {
        cachedConfig = null;
        if (mountObserver) {
            try {
                mountObserver.disconnect();
            } catch (e) {}
            mountObserver = null;
        }
        if (mountTimer) {
            try {
                clearTimeout(mountTimer);
            } catch (e) {}
            mountTimer = 0;
        }
        try {
            clearTableAutoWatch();
        } catch (e1) {}
        try {
            clearIntervalAutoWatch();
        } catch (e2) {}
        lastTableSnap = '';
        lastPlanHash = '';
        var u = document.getElementById(MOUNT_ID);
        if (u) {
            try {
                u.remove();
            } catch (e) {}
        }
        closePicker();
        try {
            window.__myScriptCleanup = undefined;
        } catch (e) {}
    };
})();
