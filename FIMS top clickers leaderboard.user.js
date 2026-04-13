// ==UserScript==
// @name         FIMS top clickers leaderboard
// @namespace    Wolf 2.0
// @version      1.3.0
// @description  Leaderboard of FIMS message senders (by FIM #); tab opens list in the FIMS area
// @match        https://opssuitemain.swacorp.com/*
// @donkeycode-pref {"fimsTopClickersMaxNames":{"type":"number","group":"Leaderboard","label":"Max names shown","description":"0 = show everyone with a count. Set a positive number only if you want to cap a very long list.","default":0,"min":0,"max":500,"step":1},"fimsTopClickersPersist":{"type":"boolean","group":"Leaderboard","label":"Persist counts","description":"Keep running totals in localStorage across reloads (same browser profile).","default":true},"fimsTopClickersStorageKey":{"type":"string","group":"Leaderboard","label":"Storage key suffix","description":"Change if you need separate stats per machine; stored as donkeycode.fimsTopClickers.<suffix>","default":"default"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/FIMS%20top%20clickers%20leaderboard.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/FIMS%20top%20clickers%20leaderboard.user.js
// ==/UserScript==

(function() {
    'use strict';

    var TABLE_ID = 'fims-id';
    var TAB_ID = 'dc-fims-top-clickers-host';
    var PANEL_ID = 'dc-fims-top-clickers-panel';
    var STYLE_ID = 'dc-fims-top-clickers-style';

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

    function getListLimit() {
        var n = Number(getPref('fimsTopClickersMaxNames', 0));
        if (!Number.isFinite(n) || n <= 0) {
            return Infinity;
        }
        return Math.min(500, Math.floor(n));
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
        } catch (e) {
            /* ignore */
        }
        return { fimToSender: fimToSender, counts: counts };
    }

    function writeState(map) {
        if (!shouldPersist()) {
            return;
        }
        try {
            localStorage.setItem(storageKey(), JSON.stringify({ v: 2, fimToSender: map }));
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
        var lim = getListLimit();
        if (lim === Infinity || pairs.length <= lim) {
            return pairs;
        }
        return pairs.slice(0, lim);
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var css = [
            '#' + PANEL_ID + '.dc-fims-tc-wrap{',
            'display:none;',
            'padding:0;',
            'background:linear-gradient(145deg,#1a1a2e 0%,#16213e 45%,#0f3460 100%);',
            'border-radius:12px;',
            'box-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06);',
            'overflow:hidden;',
            'max-height:70vh;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-inner{',
            'padding:16px 18px 18px;',
            'color:#e8e8ef;',
            'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-head{',
            'display:flex;',
            'align-items:center;',
            'justify-content:space-between;',
            'gap:12px;',
            'margin-bottom:14px;',
            'padding-bottom:12px;',
            'border-bottom:1px solid rgba(255,255,255,.12);',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-title{',
            'font-weight:700;',
            'font-size:1.15rem;',
            'letter-spacing:.02em;',
            'background:linear-gradient(90deg,#ffd93d,#ff6b6b 50%,#c56cf0);',
            '-webkit-background-clip:text;',
            'background-clip:text;',
            '-webkit-text-fill-color:transparent;',
            'text-shadow:none;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-sub{',
            'font-size:.75rem;',
            'opacity:.75;',
            'color:#b8c5d6;',
            'margin-top:2px;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-emoji{',
            'font-size:1.75rem;',
            'line-height:1;',
            'filter:drop-shadow(0 2px 4px rgba(0,0,0,.3));',
            '}',
            '#' + PANEL_ID + ' .dc-fims-top-clickers-ol{',
            'list-style:none;',
            'margin:0;',
            'padding:0;',
            'display:flex;',
            'flex-direction:column;',
            'gap:8px;',
            'max-height:calc(70vh - 120px);',
            'overflow:auto;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-row{',
            'display:flex;',
            'align-items:center;',
            'gap:12px;',
            'padding:10px 12px;',
            'border-radius:10px;',
            'background:rgba(255,255,255,.06);',
            'border:1px solid rgba(255,255,255,.08);',
            'transition:transform .15s ease,box-shadow .15s ease;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-row:hover{',
            'transform:translateX(4px);',
            'box-shadow:0 4px 16px rgba(0,0,0,.2);',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-row--1{',
            'background:linear-gradient(90deg,rgba(255,215,0,.25),rgba(255,215,0,.08));',
            'border-color:rgba(255,215,0,.35);',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-row--2{',
            'background:linear-gradient(90deg,rgba(192,192,192,.2),rgba(192,192,192,.06));',
            'border-color:rgba(200,200,210,.3);',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-row--3{',
            'background:linear-gradient(90deg,rgba(205,127,50,.22),rgba(205,127,50,.07));',
            'border-color:rgba(205,127,50,.35);',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-rank{',
            'flex:0 0 2rem;',
            'width:2rem;',
            'height:2rem;',
            'border-radius:50%;',
            'display:flex;',
            'align-items:center;',
            'justify-content:center;',
            'font-weight:800;',
            'font-size:.85rem;',
            'background:rgba(0,0,0,.25);',
            'color:#fff;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-row--1 .dc-fims-tc-rank,',
            '#' + PANEL_ID + ' .dc-fims-tc-row--2 .dc-fims-tc-rank,',
            '#' + PANEL_ID + ' .dc-fims-tc-row--3 .dc-fims-tc-rank{',
            'background:transparent;',
            'font-size:1.35rem;',
            'line-height:1;',
            'width:auto;',
            'min-width:2.25rem;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-name{',
            'flex:1;',
            'min-width:0;',
            'font-weight:600;',
            'font-size:.95rem;',
            'letter-spacing:.01em;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-count{',
            'flex:0 0 auto;',
            'font-variant-numeric:tabular-nums;',
            'font-weight:800;',
            'font-size:1.1rem;',
            'padding:4px 12px;',
            'border-radius:999px;',
            'background:rgba(255,107,107,.2);',
            'color:#ffb4b4;',
            'border:1px solid rgba(255,107,107,.35);',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-row--1 .dc-fims-tc-count{',
            'background:rgba(255,215,0,.25);',
            'color:#ffe566;',
            'border-color:rgba(255,215,0,.4);',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-empty{',
            'text-align:center;',
            'padding:28px 16px;',
            'opacity:.65;',
            'font-style:italic;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-reset.ui.button{',
            'margin-top:14px !important;',
            'background:linear-gradient(180deg,#4a4e69,#3d4154) !important;',
            'color:#e8e8ef !important;',
            'border:1px solid rgba(255,255,255,.15) !important;',
            'border-radius:8px !important;',
            '}',
            '#' + PANEL_ID + ' .dc-fims-tc-reset.ui.button:hover{',
            'filter:brightness(1.12);',
            '}'
        ].join('');
        var el = document.createElement('style');
        el.id = STYLE_ID;
        el.textContent = css;
        (document.head || document.documentElement).appendChild(el);
    }

    function render(panel) {
        if (!panel) {
            return;
        }
        var ol = panel.querySelector('.dc-fims-top-clickers-ol');
        if (!ol) {
            return;
        }
        var list = topList();
        ol.innerHTML = '';
        var medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
        var i;
        for (i = 0; i < list.length; i++) {
            var rank = i + 1;
            var li = document.createElement('li');
            li.className = 'dc-fims-tc-row';
            if (rank <= 3) {
                li.classList.add('dc-fims-tc-row--' + rank);
            }
            var rankEl = document.createElement('span');
            rankEl.className = 'dc-fims-tc-rank';
            rankEl.textContent = rank <= 3 ? medals[rank - 1] : String(rank);
            var nameEl = document.createElement('span');
            nameEl.className = 'dc-fims-tc-name';
            nameEl.textContent = list[i].name;
            var countEl = document.createElement('span');
            countEl.className = 'dc-fims-tc-count';
            countEl.textContent = String(list[i].n);
            countEl.title = 'FIMs';
            li.appendChild(rankEl);
            li.appendChild(nameEl);
            li.appendChild(countEl);
            ol.appendChild(li);
        }
        if (list.length === 0) {
            var empty = document.createElement('li');
            empty.className = 'dc-fims-tc-empty';
            empty.textContent = 'No senders yet — check back after new FIMs land.';
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

    function getSegments(menu) {
        var p = menu.parentElement;
        if (!p) {
            return [];
        }
        var out = [];
        var ch = p.children;
        var i;
        for (i = 0; i < ch.length; i++) {
            var el = ch[i];
            if (el.classList && el.classList.contains('ui') && el.classList.contains('bottom') && el.classList.contains('attached') && el.classList.contains('segment')) {
                out.push(el);
            }
        }
        return out;
    }

    function onTopClickersTabClick(e) {
        e.preventDefault();
        e.stopPropagation();
        showLeaderboardInFimsArea();
    }

    function onFimsTabClick() {
        showFimsTable();
    }

    function onAdvisoriesTabClick() {
        var tab = document.getElementById(TAB_ID);
        if (tab) {
            tab.classList.remove('active');
        }
        var table = document.getElementById(TABLE_ID);
        var panel = document.getElementById(PANEL_ID);
        if (table) {
            table.style.display = '';
        }
        if (panel) {
            panel.style.display = 'none';
        }
    }

    function showLeaderboardInFimsArea() {
        var menuInfo = findTabMenu();
        var tab = document.getElementById(TAB_ID);
        var table = document.getElementById(TABLE_ID);
        var panel = document.getElementById(PANEL_ID);
        if (!tab || !table || !panel || !menuInfo) {
            return;
        }
        var menu = menuInfo.menu;
        var items = menu.querySelectorAll('a.item');
        var i;
        for (i = 0; i < items.length; i++) {
            items[i].classList.remove('active');
        }
        tab.classList.add('active');

        var segments = getSegments(menu);
        if (segments.length >= 2) {
            segments[0].classList.add('active');
            segments[1].classList.remove('active');
        } else if (segments.length === 1) {
            segments[0].classList.add('active');
        }

        table.style.display = 'none';
        panel.style.display = 'block';
        render(panel);
    }

    function showFimsTable() {
        var tab = document.getElementById(TAB_ID);
        if (tab) {
            tab.classList.remove('active');
        }
        var table = document.getElementById(TABLE_ID);
        var panel = document.getElementById(PANEL_ID);
        if (table) {
            table.style.display = '';
        }
        if (panel) {
            panel.style.display = 'none';
        }
    }

    function wireSiblingTabs(menu) {
        if (!menu || menu.dataset.dcFimsTopClickersTabWire) {
            return;
        }
        menu.dataset.dcFimsTopClickersTabWire = '1';
        var links = menu.querySelectorAll('a.item');
        var j;
        for (j = 0; j < links.length; j++) {
            var link = links[j];
            if (link.id === TAB_ID) {
                continue;
            }
            var txt = (link.textContent || '').replace(/\s+/g, ' ');
            if (txt.indexOf('FIMS') !== -1) {
                link.addEventListener('click', onFimsTabClick);
            } else if (txt.indexOf('Advisories') !== -1) {
                link.addEventListener('click', onAdvisoriesTabClick);
            }
        }
    }

    function ensurePanel() {
        var existing = document.getElementById(PANEL_ID);
        if (existing) {
            return existing;
        }
        ensureStyles();
        var table = document.getElementById(TABLE_ID);
        if (!table || !table.parentNode) {
            return null;
        }
        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'dc-fims-tc-wrap';
        panel.style.display = 'none';

        var inner = document.createElement('div');
        inner.className = 'dc-fims-tc-inner';

        var head = document.createElement('div');
        head.className = 'dc-fims-tc-head';
        var headText = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'dc-fims-tc-title';
        title.textContent = 'Top clickers';
        var sub = document.createElement('div');
        sub.className = 'dc-fims-tc-sub';
        sub.textContent = 'Who sent the most FIMs (one count per FIM #)';
        headText.appendChild(title);
        headText.appendChild(sub);
        var emoji = document.createElement('span');
        emoji.className = 'dc-fims-tc-emoji';
        emoji.setAttribute('aria-hidden', 'true');
        emoji.textContent = '\u{1F3C6}';
        head.appendChild(headText);
        head.appendChild(emoji);
        inner.appendChild(head);

        var ol = document.createElement('ol');
        ol.className = 'dc-fims-top-clickers-ol';
        inner.appendChild(ol);

        var reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = 'Reset counts';
        reset.title = 'Clears all saved leaderboard data for this page (counts and per-FIM senders). Same as wiping localStorage for this script\'s key.';
        reset.className = 'ui mini button dc-fims-tc-reset';
        reset.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            fimToSender = {};
            counts = {};
            writeState(fimToSender);
            render(panel);
        });
        inner.appendChild(reset);
        panel.appendChild(inner);

        table.parentNode.insertBefore(panel, table);
        render(panel);
        return panel;
    }

    function ensureTab() {
        var existing = document.getElementById(TAB_ID);
        if (existing) {
            return existing;
        }
        var found = findTabMenu();
        if (!found) {
            return null;
        }
        wireSiblingTabs(found.menu);

        var a = document.createElement('a');
        a.id = TAB_ID;
        a.className = 'item';
        a.href = '#';
        a.innerHTML = '<div><span aria-hidden="true">\u{1F3C6}</span> Top clickers</div>';
        a.addEventListener('click', onTopClickersTabClick);
        found.advisoriesTab.insertAdjacentElement('afterend', a);
        return a;
    }

    function ensureUi() {
        ensureTab();
        ensurePanel();
    }

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
                ensureUi();
                var panel = document.getElementById(PANEL_ID);
                if (panel && panel.style.display !== 'none') {
                    render(panel);
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
            t.style.display = '';
        }
        var menuInfo = findTabMenu();
        if (menuInfo && menuInfo.menu) {
            delete menuInfo.menu.dataset.dcFimsTopClickersTabWire;
            var links = menuInfo.menu.querySelectorAll('a.item');
            var i;
            for (i = 0; i < links.length; i++) {
                var link = links[i];
                if (link.id === TAB_ID) {
                    continue;
                }
                var txt = (link.textContent || '').replace(/\s+/g, ' ');
                if (txt.indexOf('FIMS') !== -1) {
                    link.removeEventListener('click', onFimsTabClick);
                } else if (txt.indexOf('Advisories') !== -1) {
                    link.removeEventListener('click', onAdvisoriesTabClick);
                }
            }
        }
        var tab = document.getElementById(TAB_ID);
        if (tab) {
            tab.removeEventListener('click', onTopClickersTabClick);
            if (tab.parentNode) {
                tab.parentNode.removeChild(tab);
            }
        }
        var panel = document.getElementById(PANEL_ID);
        if (panel && panel.parentNode) {
            panel.parentNode.removeChild(panel);
        }
        var st = document.getElementById(STYLE_ID);
        if (st && st.parentNode) {
            st.parentNode.removeChild(st);
        }
        window.__myScriptCleanup = undefined;
    };
})();
