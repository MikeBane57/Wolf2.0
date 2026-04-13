// ==UserScript==
// @name         FIMS top clickers leaderboard
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  Leaderboard of FIMS message senders (by FIM #); panel next to Advisories tab
// @match        https://opssuitemain.swacorp.com/*
// @donkeycode-pref {"fimsTopClickersTopN":{"type":"number","group":"Leaderboard","label":"Show top N","description":"How many names to list in the box.","default":10,"min":3,"max":30,"step":1},"fimsTopClickersPersist":{"type":"boolean","group":"Leaderboard","label":"Persist counts","description":"Keep running totals in localStorage across reloads (same browser profile).","default":true},"fimsTopClickersStorageKey":{"type":"string","group":"Leaderboard","label":"Storage key suffix","description":"Change if you need separate stats per machine; stored as donkeycode.fimsTopClickers.<suffix>","default":"default"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/FIMS%20top%20clickers%20leaderboard.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/FIMS%20top%20clickers%20leaderboard.user.js
// ==/UserScript==

(function() {
    'use strict';

    var TABLE_ID = 'fims-id';
    var HOST_ID = 'dc-fims-top-clickers-host';

    var EXT_LINE_RE = /\/\s*EXT\s+\d{3}-\d{3}-\d{4}/;
    var NAME_WORD_RE = /^[A-Za-z][A-Za-z'\-\.]*$/;
    var BAD_NAME_WORDS = {
        WILL: 1, SWAP: 1, TERMINATE: 1, HOLD: 1, PLAN: 1, DUE: 1, FLT: 1, CNLD: 1, LINE: 1, FROM: 1,
        INTO: 1, WITH: 1, THE: 1, AND: 1, FOR: 1, ARE: 1, NOT: 1, NOW: 1, ORIGINATE: 1, DIVERT: 1,
        STUB: 1, POSITION: 1, CANCELED: 1, RETURN: 1, GATE: 1, INTL: 1, OTS: 1, MX: 1, OTP: 1, PAX: 1,
        ROUTING: 1, SCHEDULED: 1, UNSCHEDULED: 1, OPERATIONAL: 1, BUSTED: 1, STATION: 1, CREW: 1, PILOT: 1,
        ATTENDANT: 1, FA: 1, CA: 1, FO: 1, SECURITY: 1, MEDICAL: 1, PASSENGER: 1, THRU: 1, CONX: 1, RED: 1,
        EYE: 1, TURN: 1, TIME: 1, RECOVERY: 1, DELAYS: 1, BIRD: 1, STRIKE: 1, INSPECTION: 1, FUEL: 1,
        LOAD: 1, WEIGHT: 1, RESTRICTION: 1, TOWS: 1, BATTERY: 1, DISCHARGE: 1, LIGHT: 1, ILLUM: 1,
        ILL: 1, PASSPORT: 1, LATE: 1, SEAT: 1, REPLACE: 1, FINISH: 1, EARLY: 1, ARRIVAL: 1, DEPARTURE: 1,
        BOARD: 1, WAITING: 1, GROUND: 1, MAN: 1, HOURS: 1, OVER: 1, HIGH: 1, LOW: 1, CEILINGS: 1, WINDS: 1,
        MINOR: 1, MINORS: 1, TRAVEL: 1, ACTIVE: 1, ISSUED: 1, WEATHER: 1, ADVISORY: 1, GENERAL: 1, FILTER: 1
    };

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

    function getTopN() {
        var n = Number(getPref('fimsTopClickersTopN', 10));
        if (!Number.isFinite(n)) {
            return 10;
        }
        return Math.min(30, Math.max(3, Math.floor(n)));
    }

    function shouldPersist() {
        return getPref('fimsTopClickersPersist', true) !== false;
    }

    function storageKey() {
        var suf = String(getPref('fimsTopClickersStorageKey', 'default') || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
        return 'donkeycode.fimsTopClickers.' + suf;
    }

    function normalizeName(s) {
        return String(s || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b([A-Za-z])([a-z]+)\b/g, function(_, a, b) {
                return a.toUpperCase() + b.toLowerCase();
            });
    }

    function looksLikePersonName(line) {
        var parts = line.split(/\s+/).filter(Boolean);
        if (parts.length < 2 || parts.length > 6) {
            return false;
        }
        for (var i = 0; i < parts.length; i++) {
            if (!NAME_WORD_RE.test(parts[i])) {
                return false;
            }
        }
        return true;
    }

    function isBadNameCandidate(line) {
        var u = line.toUpperCase();
        if (/FLT\s|PLAN\s|LINE\s|DUE\s|CNLD|N\d{3,4}[A-Z]?|EXT\s+\d{3}-\d{3}-\d{4}|469-603-\d{4}/i.test(line)) {
            return true;
        }
        var parts = line.split(/\s+/);
        for (var i = 0; i < parts.length; i++) {
            if (BAD_NAME_WORDS[parts[i].toUpperCase()]) {
                return true;
            }
        }
        if (parts.length === 2 && parts[0].length <= 2 && parts[1].length <= 2) {
            return true;
        }
        return false;
    }

    function extractSenderFromFimText(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        var raw = text.split(/\r?\n/);
        var lines = [];
        for (var i = 0; i < raw.length; i++) {
            var t = raw[i].trim();
            if (t) {
                lines.push(t);
            }
        }
        var j;
        for (j = 0; j < lines.length - 1; j++) {
            if (EXT_LINE_RE.test(lines[j])) {
                var cand = lines[j + 1];
                if (looksLikePersonName(cand) && !isBadNameCandidate(cand)) {
                    return cand;
                }
            }
        }
        for (j = lines.length - 1; j >= 0; j--) {
            var line = lines[j];
            if (line.length > 140) {
                continue;
            }
            if (isBadNameCandidate(line)) {
                continue;
            }
            if (looksLikePersonName(line)) {
                return line;
            }
        }
        return '';
    }

    function recomputeCountsFromFimMap(fimToSender) {
        var out = {};
        var k;
        for (k in fimToSender) {
            if (Object.prototype.hasOwnProperty.call(fimToSender, k)) {
                var name = fimToSender[k];
                out[name] = (out[name] || 0) + 1;
            }
        }
        return out;
    }

    function readState() {
        var fimToSender = {};
        var counts = {};
        if (!shouldPersist()) {
            return { fimToSender: fimToSender, counts: counts };
        }
        try {
            var raw = localStorage.getItem(storageKey());
            if (!raw) {
                return { fimToSender: fimToSender, counts: counts };
            }
            var o = JSON.parse(raw);
            if (o && typeof o.fimToSender === 'object' && o.fimToSender) {
                var fk;
                for (fk in o.fimToSender) {
                    if (Object.prototype.hasOwnProperty.call(o.fimToSender, fk)) {
                        var nm = normalizeName(o.fimToSender[fk]);
                        if (nm) {
                            fimToSender[fk] = nm;
                        }
                    }
                }
                counts = recomputeCountsFromFimMap(fimToSender);
                return { fimToSender: fimToSender, counts: counts };
            }
            /* Legacy v1 had only counts — drop it to avoid double-count after reload */
        } catch (e) {
            /* ignore */
        }
        return { fimToSender: fimToSender, counts: counts };
    }

    function writeState(fimToSender) {
        if (!shouldPersist()) {
            return;
        }
        try {
            localStorage.setItem(storageKey(), JSON.stringify({ v: 2, fimToSender: fimToSender }));
        } catch (e) {
            /* ignore */
        }
    }

    var state = readState();
    var fimToSender = state.fimToSender;
    var counts = state.counts;

    function mergeRow(fimKey, senderRaw) {
        if (!fimKey || !senderRaw) {
            return;
        }
        var sender = normalizeName(senderRaw);
        if (!sender) {
            return;
        }
        if (fimToSender[fimKey] === sender) {
            return;
        }
        if (fimToSender[fimKey] !== undefined) {
            var prev = fimToSender[fimKey];
            counts[prev] = Math.max(0, (counts[prev] || 1) - 1);
            if (counts[prev] === 0) {
                delete counts[prev];
            }
        }
        fimToSender[fimKey] = sender;
        counts[sender] = (counts[sender] || 0) + 1;
        writeState(fimToSender);
    }

    function scanTable(table) {
        if (!table || table.id !== TABLE_ID) {
            return;
        }
        var rows = table.querySelectorAll('tbody tr');
        for (var i = 0; i < rows.length; i++) {
            var tr = rows[i];
            var cells = tr.querySelectorAll('td');
            if (cells.length < 2) {
                continue;
            }
            var fimKey = (cells[0].textContent || '').replace(/\s+/g, ' ').trim();
            if (!/^\d+$/.test(fimKey)) {
                continue;
            }
            var pre = cells[1].querySelector('pre');
            if (!pre) {
                continue;
            }
            var sender = extractSenderFromFimText(pre.textContent || '');
            if (!sender) {
                continue;
            }
            mergeRow(fimKey, sender);
        }
    }

    function topList() {
        var pairs = [];
        var k;
        for (k in counts) {
            if (Object.prototype.hasOwnProperty.call(counts, k)) {
                pairs.push({ name: k, n: counts[k] });
            }
        }
        pairs.sort(function(a, b) {
            if (b.n !== a.n) {
                return b.n - a.n;
            }
            return a.name.localeCompare(b.name);
        });
        return pairs.slice(0, getTopN());
    }

    function render(host) {
        var list = topList();
        var ol = host.querySelector('.dc-fims-top-clickers-ol');
        if (!ol) {
            return;
        }
        ol.innerHTML = '';
        for (var i = 0; i < list.length; i++) {
            var li = document.createElement('li');
            li.textContent = list[i].name + ' — ' + list[i].n;
            ol.appendChild(li);
        }
        if (list.length === 0) {
            var empty = document.createElement('li');
            empty.textContent = 'No senders yet';
            empty.style.opacity = '0.7';
            ol.appendChild(empty);
        }
    }

    function findTabMenu() {
        var menus = document.querySelectorAll('.ui.attached.tabular.menu');
        if (!menus.length) {
            return null;
        }
        var i;
        for (i = 0; i < menus.length; i++) {
            var m = menus[i];
            var links = m.querySelectorAll('a.item');
            var j;
            for (j = 0; j < links.length; j++) {
                if ((links[j].textContent || '').indexOf('Advisories') !== -1) {
                    return { menu: m, advisoriesTab: links[j] };
                }
            }
        }
        return null;
    }

    function ensureHost() {
        var existing = document.getElementById(HOST_ID);
        if (existing) {
            return existing;
        }
        var found = findTabMenu();
        if (!found) {
            return null;
        }
        var host = document.createElement('div');
        host.id = HOST_ID;
        host.className = 'item';
        host.style.cssText = [
            'padding:0.4em 0.85em !important',
            'cursor:default',
            'max-width:22em',
            'vertical-align:top'
        ].join(';');

        var title = document.createElement('div');
        title.textContent = 'Top clickers';
        title.style.cssText = 'font-weight:600;font-size:0.8em;margin-bottom:0.2em;white-space:nowrap';
        host.appendChild(title);

        var ol = document.createElement('ol');
        ol.className = 'dc-fims-top-clickers-ol';
        ol.style.cssText = 'margin:0;padding-left:1.1em;font-size:0.75em;line-height:1.35;max-height:9em;overflow:auto';
        host.appendChild(ol);

        var reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = 'Reset';
        reset.className = 'ui mini button';
        reset.style.cssText = 'margin-top:0.35em;padding:0.25em 0.5em;font-size:0.7em';
        reset.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            fimToSender = {};
            counts = {};
            writeState(fimToSender);
            render(host);
        });
        host.appendChild(reset);

        found.advisoriesTab.insertAdjacentElement('afterend', host);
        render(host);
        return host;
    }

    var hostEl = null;
    var scanTimer = null;
    var rootMo = null;
    var tableMo = null;

    function scheduleScan() {
        if (scanTimer) {
            clearTimeout(scanTimer);
        }
        scanTimer = setTimeout(function() {
            scanTimer = null;
            var t = document.getElementById(TABLE_ID);
            if (t) {
                scanTable(t);
                hostEl = ensureHost();
                if (hostEl) {
                    render(hostEl);
                }
            }
        }, 120);
    }

    function wireTable(table) {
        if (!table || table.dataset.dcFimsTopClickersMo) {
            return;
        }
        table.dataset.dcFimsTopClickersMo = '1';
        tableMo = new MutationObserver(function() {
            scheduleScan();
        });
        tableMo.observe(table, { childList: true, subtree: true, characterData: true });
    }

    function boot() {
        var table = document.getElementById(TABLE_ID);
        if (table) {
            wireTable(table);
            scheduleScan();
        }
        if (rootMo) {
            return;
        }
        rootMo = new MutationObserver(function() {
            var t = document.getElementById(TABLE_ID);
            if (t) {
                wireTable(t);
            }
            scheduleScan();
        });
        rootMo.observe(document.documentElement, { childList: true, subtree: true });
        scheduleScan();
    }

    boot();

    window.__myScriptCleanup = function() {
        if (scanTimer) {
            clearTimeout(scanTimer);
            scanTimer = null;
        }
        if (tableMo) {
            tableMo.disconnect();
            tableMo = null;
        }
        if (rootMo) {
            rootMo.disconnect();
            rootMo = null;
        }
        var t = document.getElementById(TABLE_ID);
        if (t) {
            delete t.dataset.dcFimsTopClickersMo;
        }
        var h = document.getElementById(HOST_ID);
        if (h && h.parentNode) {
            h.parentNode.removeChild(h);
        }
        hostEl = null;
        window.__myScriptCleanup = undefined;
    };
})();
