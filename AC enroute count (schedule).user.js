// ==UserScript==
// @name         AC enroute count (schedule)
// @namespace    Wolf 2.0
// @version      1.6.0
// @description  Count inbound enroute aircraft seen for the selected station using active puck classes.
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @donkeycode-pref {"acEnrouteDebugMatchLog":{"type":"boolean","group":"AC enroute · debug","label":"Log each MATCH to page console","description":"Logs every counted puck (dep/arr, flight #, active class source). Default ON during tuning.","default":true},"acEnrouteDebugTickLog":{"type":"boolean","group":"AC enroute · debug","label":"Log periodic scan summary (tick)","description":"Every ~4s while the map updates: puck count, active pucks, station filter. Default ON; turn OFF to reduce noise.","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20enroute%20count%20(schedule).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20enroute%20count%20(schedule).user.js
// ==/UserScript==

(function () {
    'use strict';

    var HOST_ROW_ATTR = 'data-dc-ac-enroute-row';
    var LABEL_TEXT = 'AC enroute';
    var PUCK_QE = '[data-qe-id="as-flight-leg-puck"]';
    var PUCK_CLASS_TOKEN = 'CScizp4RisE';
    var ACTIVE_PUCK_PARENT_TOKENS = ['Jn6rvhVag-w', 'xPQOsm8XFgk'];
    var ACTIVE_PUCK_TARGET_SEL =
        '[class*="Jn6rvhVag-w"] [class*="CScizp4RisE"], ' +
        '[class*="xPQOsm8XFgk"] [class*="CScizp4RisE"]';
    /** Station code cells on puck — arrival uses distinct second class (see ops map markup). */
    var STATION_CELL_SUBSEL = '[class*="tg9Iiv9oAOo="]';
    /** Departure airport cell pairs base station class with this token (ops map) */
    var DEP_STATION_EXTRA_SUBSEL = '[class*="zbA1EvKL1Bo="]';
    /** Arrival airport cell — pairs tg9Iiv9oAOo with this token */
    var ARR_STATION_EXTRA_SUBSEL = '[class*="Ziu3-r4LY1M="]';
    var STATION_COMBO = 'div[name="station"][role="combobox"], div[name="station"]';

    var mo = null;
    var debounceTimer = null;
    var groundMo = null;
    var stationObservers = [];
    var stationEventListener = null;
    var stationEventCombos = [];
    var FLOAT_HOST_ATTR = 'data-dc-ac-enroute-float';
    var tickLogLastMs = 0;
    var noStationLogLastMs = 0;
    var lastStationCode = '';
    var lastScanSignature = '';
    var lastScanResult = null;
    var seenPucks = {};
    var seenPuckCount = 0;
    var TICK_LOG_MS = 4000;

    function elementHasClassToken(el, token) {
        if (!el || !token) {
            return false;
        }
        return String(el.className || '').indexOf(token) !== -1;
    }

    function isActivePuck(puck) {
        if (!puck || !elementHasClassToken(puck, PUCK_CLASS_TOKEN)) {
            return false;
        }
        var cur = puck.parentElement;
        var hop = 0;
        while (cur && hop < 8) {
            for (var i = 0; i < ACTIVE_PUCK_PARENT_TOKENS.length; i++) {
                if (elementHasClassToken(cur, ACTIVE_PUCK_PARENT_TOKENS[i])) {
                    return true;
                }
            }
            cur = cur.parentElement;
            hop++;
        }
        return false;
    }

    function activePuckSourceClass(puck) {
        if (!puck) {
            return '';
        }
        var cur = puck.parentElement;
        var hop = 0;
        while (cur && hop < 8) {
            for (var i = 0; i < ACTIVE_PUCK_PARENT_TOKENS.length; i++) {
                if (elementHasClassToken(cur, ACTIVE_PUCK_PARENT_TOKENS[i])) {
                    return ACTIVE_PUCK_PARENT_TOKENS[i];
                }
            }
            cur = cur.parentElement;
            hop++;
        }
        return '';
    }

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

    function boolPref(key, def) {
        var v = getPref(key, def);
        return v === true || v === 'true';
    }

    function debugTickEnabled() {
        return boolPref('acEnrouteDebugTickLog', true);
    }

    function textLooksLikeStationCode(s) {
        var t = String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(t) ? t : '';
    }

    function flightNumberFromPuck(puck) {
        if (!puck || !puck.querySelector) {
            return '';
        }
        var inPuck = puck.querySelector('[class*="tw9pR6Lavy8="]');
        if (inPuck) {
            var txt = String(inPuck.textContent || '')
                .replace(/\s+/g, '')
                .trim();
            if (/^\d{1,4}$/.test(txt)) {
                return txt;
            }
        }
        return '';
    }

    function stablePuckKey(puck, dep, arr) {
        if (!puck) {
            return '';
        }
        var hoverId = puck.getAttribute && puck.getAttribute('data-linked-hover-id');
        if (hoverId) {
            return 'hover:' + hoverId;
        }
        return ['route', dep || '?', arr || '?', flightNumberFromPuck(puck) || '?'].join(':');
    }

    function stationCodeFromCombo(combo) {
        if (!combo) {
            return '';
        }
        var dv = combo.querySelector('.divider.text, .text.divider');
        if (dv) {
            if (dv.classList && dv.classList.contains('default')) {
                return '';
            }
            var t = textLooksLikeStationCode(dv.textContent);
            if (t) {
                return t;
            }
        }
        var direct = combo.children || [];
        for (var i = 0; i < direct.length; i++) {
            var child = direct[i];
            if (
                child &&
                child.matches &&
                !child.matches('.menu, [role="listbox"], [role="menu"]') &&
                !(child.classList && child.classList.contains('default'))
            ) {
                var ct = textLooksLikeStationCode(child.textContent);
                if (ct) {
                    return ct;
                }
            }
        }
        var dataValue = textLooksLikeStationCode(combo.getAttribute('data-value'));
        if (dataValue) {
            return dataValue;
        }
        var selected =
            combo.querySelector('[role="option"][aria-selected="true"] .text') ||
            combo.querySelector('[role="option"][aria-checked="true"] .text') ||
            combo.querySelector('.menu .item.active.selected .text') ||
            combo.querySelector('.menu .item.selected.active .text');
        if (selected && !(dv && dv.classList && dv.classList.contains('default'))) {
            var selectedText = textLooksLikeStationCode(selected.textContent);
            if (selectedText) {
                return selectedText;
            }
        }
        return '';
    }

    function readSelectedStationCode() {
        var combos = document.querySelectorAll(STATION_COMBO);
        if (!combos || !combos.length) {
            return '';
        }
        for (var i = combos.length - 1; i >= 0; i--) {
            var code = stationCodeFromCombo(combos[i]);
            if (code) {
                return code;
            }
        }
        return '';
    }

    function airportsFromPuck(puck) {
        if (!puck || !puck.querySelectorAll) {
            return [];
        }
        var nodes = puck.querySelectorAll(STATION_CELL_SUBSEL);
        var out = [];
        var i;
        for (i = 0; i < nodes.length; i++) {
            var txt = String(nodes[i].textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (/^[A-Z]{3}$/.test(txt)) {
                out.push(txt);
            }
        }
        return out;
    }

    function departureStationFromPuck(puck) {
        if (!puck || !puck.querySelector) {
            return '';
        }
        var depEl =
            puck.querySelector(STATION_CELL_SUBSEL + DEP_STATION_EXTRA_SUBSEL) ||
            null;
        if (depEl) {
            var d = String(depEl.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (/^[A-Z]{3}$/.test(d)) {
                return d;
            }
        }
        var ap = airportsFromPuck(puck);
        return ap.length >= 1 ? ap[0] : '';
    }

    function arrivalStationFromPuck(puck) {
        if (!puck || !puck.querySelector) {
            return '';
        }
        var arrEl =
            puck.querySelector(STATION_CELL_SUBSEL + ARR_STATION_EXTRA_SUBSEL) ||
            puck.querySelector(ARR_STATION_EXTRA_SUBSEL);
        if (arrEl) {
            var a = String(arrEl.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (/^[A-Z]{3}$/.test(a)) {
                return a;
            }
        }
        var ap = airportsFromPuck(puck);
        return ap.length >= 2 ? ap[1] : '';
    }

    function resetSeenPucks() {
        seenPucks = {};
        seenPuckCount = 0;
        lastScanSignature = '';
        lastScanResult = null;
    }

    function activePuckSnapshot(station) {
        var allPucks = document.querySelectorAll(PUCK_QE);
        var activePucks = document.querySelectorAll(ACTIVE_PUCK_TARGET_SEL);
        var parts = [station || '', 'pucks=' + allPucks.length, 'active=' + activePucks.length];
        for (var i = 0; i < allPucks.length; i++) {
            var puck = allPucks[i];
            parts.push(
                (puck.getAttribute && puck.getAttribute('data-linked-hover-id')) ||
                    flightNumberFromPuck(puck) ||
                    String(i)
            );
            parts.push(isActivePuck(puck) ? 'A' : 'I');
        }
        return {
            signature: parts.join('|'),
            pucks: allPucks,
            activePucks: activePucks
        };
    }

    function scanEnrouteToStation(station, debugMatch, snapshot) {
        var stats = {
            puckCount: 0,
            visibleActivePucks: 0,
            seenActivePucks: 0,
            arrMatchStation: 0,
            newlySeen: 0,
            removedSeen: 0,
            skippedOutboundSameStation: 0
        };
        if (!station) {
            return { count: 0, stats: stats };
        }
        var allPucks = snapshot && snapshot.pucks ? snapshot.pucks : document.querySelectorAll(PUCK_QE);
        var activePucks =
            snapshot && snapshot.activePucks
                ? snapshot.activePucks
                : document.querySelectorAll(ACTIVE_PUCK_TARGET_SEL);
        stats.puckCount = allPucks.length;
        stats.visibleActivePucks = activePucks.length;
        var pi;
        for (pi = 0; pi < allPucks.length; pi++) {
            var puckLeg = allPucks[pi];
            var arr = arrivalStationFromPuck(puckLeg);
            var dep = departureStationFromPuck(puckLeg);
            var key = stablePuckKey(puckLeg, dep, arr);
            if (!key) {
                continue;
            }
            var shouldCount = isActivePuck(puckLeg) && arr === station && !(dep && dep === station);
            if (!shouldCount) {
                if (seenPucks[key]) {
                    delete seenPucks[key];
                    seenPuckCount = Math.max(0, seenPuckCount - 1);
                    stats.removedSeen++;
                }
                continue;
            }
            stats.arrMatchStation++;
            if (dep && dep === station) {
                stats.skippedOutboundSameStation++;
                continue;
            }
            if (seenPucks[key]) {
                continue;
            }
            seenPucks[key] = {
                dep: dep || '',
                arr: arr || '',
                flight: flightNumberFromPuck(puckLeg) || '',
                hoverId: puckLeg.getAttribute ? puckLeg.getAttribute('data-linked-hover-id') || '' : '',
                activeClass: activePuckSourceClass(puckLeg) || ''
            };
            seenPuckCount++;
            stats.newlySeen++;
            if (debugMatch) {
                try {
                    console.log('[AC enroute] MATCH', {
                        mapStation: station,
                        dep: seenPucks[key].dep || '?',
                        arr: seenPucks[key].arr,
                        flight: seenPucks[key].flight || undefined,
                        activeClass: seenPucks[key].activeClass || undefined,
                        hoverId: seenPucks[key].hoverId || undefined,
                        source: 'seen cache'
                    });
                } catch (logErr) {}
            }
        }
        stats.seenActivePucks = seenPuckCount;
        return { count: seenPuckCount, stats: stats };
    }

    function nodeMatchesRelevantThing(el) {
        if (!el || !el.matches) {
            return false;
        }
        if (
            el.matches(STATION_COMBO) ||
            el.matches(PUCK_QE) ||
            el.matches(ACTIVE_PUCK_TARGET_SEL) ||
            elementHasClassToken(el, PUCK_CLASS_TOKEN)
        ) {
            return true;
        }
        for (var i = 0; i < ACTIVE_PUCK_PARENT_TOKENS.length; i++) {
            if (elementHasClassToken(el, ACTIVE_PUCK_PARENT_TOKENS[i])) {
                return true;
            }
        }
        return false;
    }

    function nodeTreeRelevant(node) {
        var el = node && node.nodeType === 1 ? node : node && node.parentElement;
        if (!el) {
            return false;
        }
        if (nodeMatchesRelevantThing(el)) {
            return true;
        }
        try {
            if (el.closest && el.closest(STATION_COMBO + ', ' + PUCK_QE)) {
                return true;
            }
        } catch (e) {}
        try {
            if (el.querySelector && el.querySelector(STATION_COMBO + ', ' + PUCK_QE + ', ' + ACTIVE_PUCK_TARGET_SEL)) {
                return true;
            }
        } catch (e2) {}
        var txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        return /A\/C\s+ON\s+THE\s+GROUND|ON\s+THE\s+GROUND/i.test(txt);
    }

    function mutationsRelevant(mutations) {
        if (!mutations || !mutations.length) {
            return true;
        }
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.type === 'attributes' || m.type === 'characterData') {
                if (nodeTreeRelevant(m.target)) {
                    return true;
                }
                continue;
            }
            for (var ai = 0; ai < m.addedNodes.length; ai++) {
                if (nodeTreeRelevant(m.addedNodes[ai])) {
                    return true;
                }
            }
            for (var ri = 0; ri < m.removedNodes.length; ri++) {
                if (nodeTreeRelevant(m.removedNodes[ri])) {
                    return true;
                }
            }
        }
        return false;
    }

    function findGroundStatRow() {
        var divs = document.querySelectorAll('div');
        var i;
        for (i = 0; i < divs.length; i++) {
            var row = divs[i];
            if (row.children.length !== 2) {
                continue;
            }
            var label = String(row.children[0].textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!/^A\/C\s+ON\s+THE\s+GROUND$/i.test(label)) {
                continue;
            }
            var numTxt = String(row.children[1].textContent || '').trim();
            if (/^\d+$/.test(numTxt)) {
                return row;
            }
        }
        for (i = 0; i < divs.length; i++) {
            var el = divs[i];
            if (el.children.length !== 2) {
                continue;
            }
            var lab = String(el.children[0].textContent || '').replace(/\s+/g, ' ').trim();
            if (/ON\s+THE\s+GROUND/i.test(lab) && lab.length < 40) {
                return el;
            }
        }
        return null;
    }

    function removeFloatingHud() {
        try {
            var fh = document.querySelector('[' + FLOAT_HOST_ATTR + '="1"]');
            if (fh) {
                fh.remove();
            }
        } catch (e) {}
    }

    /**
     * Fixed overlay when “A/C ON THE GROUND” row is missing so count + tick logs still run.
     */
    function ensureFloatingHud(cnt, stationCode, stats) {
        var host = document.querySelector('[' + FLOAT_HOST_ATTR + '="1"]');
        if (!host) {
            host = document.createElement('div');
            host.setAttribute(FLOAT_HOST_ATTR, '1');
            host.style.cssText =
                'position:fixed;top:12px;right:12px;z-index:2147483646;' +
                'font:12px/1.35 system-ui,-apple-system,sans-serif;' +
                'background:rgba(15,23,42,.94);color:#e2e8f0;padding:10px 14px;' +
                'border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.4);' +
                'pointer-events:none;max-width:min(420px,calc(100vw - 24px));';
            try {
                document.documentElement.appendChild(host);
            } catch (e2) {
                try {
                    document.body.appendChild(host);
                } catch (e3) {}
            }
        }
        var line1 =
            '<strong style="color:#93c5fd">AC enroute</strong>: ' +
            String(cnt) +
            (stationCode ? ' · <span style="opacity:.85">' + escapeHtml(stationCode) + '</span>' : '');
        var line2 =
            stats &&
            '<span style="opacity:.75;font-size:11px">' +
            'visible pucks ' +
            stats.puckCount +
            ' · visible active ' +
            stats.visibleActivePucks +
            ' · seen active ' +
            stats.seenActivePucks +
            ' · new +' +
            stats.newlySeen +
            '</span>';
        var hint =
            stats && stats.puckCount === 0
                ? '<div style="margin-top:6px;font-size:11px;opacity:.85">No flight pucks in DOM — scroll/zoom map or wait for load.</div>'
                : '';
        host.innerHTML =
            '<div>' +
            line1 +
            '</div>' +
            (line2 ? '<div style="margin-top:4px">' + line2 + '</div>' : '') +
            hint +
            '<div style="margin-top:6px;font-size:10px;opacity:.55">HUD: stats row not found</div>';
    }

    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ensureEnrouteRow() {
        var existing = document.querySelector('[' + HOST_ROW_ATTR + '="1"]');
        var groundRow = findGroundStatRow();

        var st = readSelectedStationCode();
        var stationChanged = st !== lastStationCode;
        if (stationChanged) {
            resetSeenPucks();
        }
        lastStationCode = st;
        if (!st) {
            lastScanSignature = '';
            lastScanResult = null;
            var nowNoStation = Date.now();
            if (debugTickEnabled() && nowNoStation - noStationLogLastMs >= TICK_LOG_MS) {
                noStationLogLastMs = nowNoStation;
                try {
                    console.log('[AC enroute] NO STATION', {
                        stationCombos: document.querySelectorAll(STATION_COMBO).length,
                        pucks: document.querySelectorAll(PUCK_QE).length,
                        activePucks: document.querySelectorAll(ACTIVE_PUCK_TARGET_SEL).length
                    });
                } catch (eNoStation) {}
            }
            if (existing) {
                try {
                    existing.remove();
                } catch (e) {}
            }
            removeFloatingHud();
            return;
        }
        var dbgMatch = boolPref('acEnrouteDebugMatchLog', true);
        var dbgTick = debugTickEnabled();

        var snapshot = activePuckSnapshot(st);
        var scanChanged = stationChanged || snapshot.signature !== lastScanSignature || !lastScanResult;
        var scanned = scanChanged ? scanEnrouteToStation(st, dbgMatch, snapshot) : lastScanResult;
        if (scanChanged) {
            lastScanSignature = snapshot.signature;
            lastScanResult = scanned;
        }
        var cnt = scanned.count;
        var stats = scanned.stats;

        var now = Date.now();
        if (dbgTick && scanChanged) {
            tickLogLastMs = now;
            try {
                console.log('[AC enroute] tick', {
                    station: st || '(empty)',
                    count: cnt,
                    groundRowFound: !!groundRow,
                    pucks: stats.puckCount,
                    visibleActivePucks: stats.visibleActivePucks,
                    seenActivePucks: stats.seenActivePucks,
                    newlySeen: stats.newlySeen,
                    removedSeen: stats.removedSeen,
                    arrEqualsStationVisible: stats.arrMatchStation,
                    skippedOutboundSameStation: stats.skippedOutboundSameStation,
                    reason: stationChanged ? 'station changed' : 'active pucks changed'
                });
            } catch (e0) {}
        }

        if (!groundRow || !groundRow.parentNode) {
            if (existing) {
                try {
                    existing.remove();
                } catch (e) {}
            }
            ensureFloatingHud(cnt, st, stats);
            return;
        }

        removeFloatingHud();

        var row = existing;
        if (!row) {
            row = document.createElement('div');
            row.setAttribute(HOST_ROW_ATTR, '1');
            try {
                row.className = groundRow.className || '';
            } catch (e) {}

            var lab = document.createElement('div');
            var val = document.createElement('div');
            if (groundRow.children.length >= 2) {
                lab.className = groundRow.children[0].className || '';
                val.className = groundRow.children[1].className || '';
            }
            lab.textContent = LABEL_TEXT;
            val.setAttribute('data-dc-ac-enroute-val', '1');
            val.textContent = '0';

            row.appendChild(lab);
            row.appendChild(val);

            try {
                groundRow.parentNode.insertBefore(row, groundRow.nextSibling);
            } catch (e2) {
                groundRow.insertAdjacentElement('afterend', row);
            }
        }

        var valEl = row.querySelector('[data-dc-ac-enroute-val="1"]');
        if (!valEl) {
            return;
        }

        valEl.textContent = String(cnt);
        valEl.title =
            st
                ? 'Inbound to ' +
                  st +
                  ' (active puck class; dep≠' +
                  st +
                  ')'
                : 'Select a station to count enroute flights';
    }

    function scheduleUpdate() {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(function () {
            debounceTimer = null;
            ensureEnrouteRow();
        }, 120);
    }

    function watchGroundArea() {
        var groundRow = findGroundStatRow();
        if (!groundRow || !groundRow.parentNode) {
            return;
        }
        if (groundMo) {
            groundMo.disconnect();
            groundMo = null;
        }
        try {
            groundMo = new MutationObserver(scheduleUpdate);
            groundMo.observe(groundRow.parentNode, { childList: true, subtree: true, characterData: true });
        } catch (e) {}
    }

    function wireStationCombo(combo) {
        if (!combo || combo.getAttribute('data-dc-ac-enroute-station-obs') === '1') {
            return;
        }
        combo.setAttribute('data-dc-ac-enroute-station-obs', '1');
        try {
            var stationMo = new MutationObserver(scheduleUpdate);
            stationMo.observe(combo, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: [
                    'aria-expanded',
                    'aria-activedescendant',
                    'aria-selected',
                    'aria-checked',
                    'class',
                    'data-value'
                ]
            });
            stationObservers.push(stationMo);
        } catch (e2) {}
        if (!stationEventListener) {
            stationEventListener = function () {
                setTimeout(scheduleUpdate, 0);
            };
        }
        try {
            combo.addEventListener('click', stationEventListener, true);
            combo.addEventListener('input', stationEventListener, true);
            combo.addEventListener('change', stationEventListener, true);
            combo.addEventListener('keyup', stationEventListener, true);
            stationEventCombos.push(combo);
        } catch (e3) {}
    }

    function watchStationComboEl() {
        var combos = document.querySelectorAll(STATION_COMBO);
        if (!combos || !combos.length) {
            setTimeout(scheduleUpdate, 0);
            return;
        }
        for (var i = 0; i < combos.length; i++) {
            wireStationCombo(combos[i]);
        }
    }

    function init() {
        if (debugTickEnabled()) {
            try {
                console.log('[AC enroute] init', {
                    stationCombos: document.querySelectorAll(STATION_COMBO).length,
                    pucks: document.querySelectorAll(PUCK_QE).length,
                    activePucks: document.querySelectorAll(ACTIVE_PUCK_TARGET_SEL).length
                });
            } catch (eInit) {}
        }
        scheduleUpdate();
        watchGroundArea();
        watchStationComboEl();
        mo = new MutationObserver(function (mutations) {
            if (!mutationsRelevant(mutations)) {
                return;
            }
            scheduleUpdate();
            watchGroundArea();
            watchStationComboEl();
        });
        try {
            mo.observe(document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['class', 'data-value', 'aria-selected', 'aria-checked']
            });
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.__myScriptCleanup = function () {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        if (mo) {
            try {
                mo.disconnect();
            } catch (e) {}
            mo = null;
        }
        if (groundMo) {
            try {
                groundMo.disconnect();
            } catch (e2) {}
            groundMo = null;
        }
        for (var si = 0; si < stationObservers.length; si++) {
            try {
                stationObservers[si].disconnect();
            } catch (e4) {}
        }
        stationObservers = [];
        if (stationEventListener) {
            for (var ei = 0; ei < stationEventCombos.length; ei++) {
                try {
                    stationEventCombos[ei].removeEventListener('click', stationEventListener, true);
                    stationEventCombos[ei].removeEventListener('input', stationEventListener, true);
                    stationEventCombos[ei].removeEventListener('change', stationEventListener, true);
                    stationEventCombos[ei].removeEventListener('keyup', stationEventListener, true);
                } catch (e6) {}
            }
        }
        stationEventCombos = [];
        stationEventListener = null;
        try {
            var wired = document.querySelectorAll('[data-dc-ac-enroute-station-obs="1"]');
            for (var wi = 0; wi < wired.length; wi++) {
                wired[wi].removeAttribute('data-dc-ac-enroute-station-obs');
            }
        } catch (e5) {}
        try {
            var r = document.querySelector('[' + HOST_ROW_ATTR + '="1"]');
            if (r) {
                r.remove();
            }
        } catch (e3) {}
        removeFloatingHud();
        tickLogLastMs = 0;
        lastStationCode = '';
        resetSeenPucks();
        window.__myScriptCleanup = undefined;
    };
})();
