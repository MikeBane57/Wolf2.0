// ==UserScript==
// @name         Pax connections - late flights
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  Alt+click a flight puck: from Pax connections outbound, queue flights in rows marked red/orange (tight) into the worksheet flight field.
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"paxLateToWsEnabled":{"type":"boolean","group":"Pax late to worksheet","label":"Enable Alt+click on flight pucks","description":"When on, Alt+left-click a puck parses visible Pax outbound (FLT) rows with red or orange exclamation (or the apps tight row style), then fills the worksheet flight search field in order.","default":true},"paxLateToWsStepMs":{"type":"number","group":"Pax late to worksheet","label":"Delay between flights (ms)","description":"Waits this long after each Enter before the next number.","default":250,"min":0,"max":5000,"step":50}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Pax%20connections%20-%20late%20flights.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Pax%20connections%20-%20late%20flights.user.js
// ==/UserScript==

(function () {
    'use strict';

    const PUCK_SELECTOR = [
        '[data-qe-id="as-flight-leg-puck"]',
        '[data-testid="puck-context-menu"]',
        '[class*="CScizp4RisE="]'
    ].join(', ');

    const BOUND = 'dataDcPaxLateToWs';
    const puckClickHandlers = new WeakMap();
    var mo = null;
    var initTimer = null;
    var pendingTimeouts = [];

    function getPref(key, def) {
        if (typeof donkeycodeGetPref !== 'function') {
            return def;
        }
        const v = donkeycodeGetPref(key);
        if (v === undefined || v === null || v === '') {
            return def;
        }
        return v;
    }

    function stepMs() {
        const n = Number(getPref('paxLateToWsStepMs', 250));
        if (!Number.isFinite(n)) {
            return 250;
        }
        return Math.min(5000, Math.max(0, Math.floor(n)));
    }

    function log() {
        console.log.apply(
            console,
            ['%c[PAX-LATE-WS]', 'color:#e67e22'].concat([].slice.call(arguments))
        );
    }

    function isNestedInCell(table) {
        return !!(table && table.closest && table.closest('td, th'));
    }

    function isOutboundPaxTable(table) {
        if (!table) {
            return false;
        }
        const tr = table.querySelector('tr');
        if (!tr) {
            return false;
        }
        const ths = tr.querySelectorAll('th');
        if (ths.length < 8) {
            return false;
        }
        const parts = [];
        for (var i = 0; i < ths.length; i++) {
            parts.push(
                ths[i].textContent.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
            );
        }
        const j = parts.join(' ');
        const hasFlt = parts.indexOf('FLT') >= 0;
        const hasNextFin = j.indexOf('NEXT') >= 0 || j.indexOf('FINAL') >= 0;
        return hasFlt && hasNextFin;
    }

    function findHeaderTr(table) {
        const rows = table.querySelectorAll('tr');
        for (var r = 0; r < rows.length; r++) {
            if (rows[r].querySelector('th')) {
                return rows[r];
            }
        }
        return null;
    }

    function findFltColumnIndex(tr) {
        const ths = tr.querySelectorAll('th');
        for (var i = 0; i < ths.length; i++) {
            if (ths[i].textContent.replace(/\s+/g, ' ').trim() === 'FLT') {
                return i;
            }
        }
        return -1;
    }

    function rowHasRedOrOrangeExclamation(tr) {
        if (!tr || tr.nodeName !== 'TR') {
            return false;
        }
        const list = tr.querySelectorAll('i');
        for (var i = 0; i < list.length; i++) {
            const ic = ' ' + String(list[i].className || '') + ' ';
            if (ic.indexOf(' exclamation') < 0 && ic.indexOf('exclamation-') < 0) {
                continue;
            }
            if (ic.indexOf(' red ') >= 0 || ic.indexOf(' orange ') >= 0) {
                return true;
            }
        }
        return false;
    }

    function isTightPaxRow(tr) {
        const cls = tr.getAttribute('class') || '';
        if (cls.indexOf('wie2jTJevTc') >= 0) {
            return true;
        }
        return false;
    }

    function isLateStyleRow(tr) {
        return rowHasRedOrOrangeExclamation(tr) || isTightPaxRow(tr);
    }

    function parseFltFromCell(td) {
        if (!td) {
            return '';
        }
        var span = td.querySelector ? td.querySelector('span') : null;
        if (span) {
            var c;
            for (c = span.firstChild; c; c = c.nextSibling) {
                if (c.nodeType === 1 && c.tagName === 'TABLE') {
                    break;
                }
                if (c.nodeType === 3) {
                    var m = String(c.nodeValue || '').match(/(\d{1,4})/);
                    if (m) {
                        return m[1];
                    }
                }
            }
        }
        var clone = td.cloneNode(true);
        var nest = clone.querySelector('table');
        if (nest) {
            nest.remove();
        }
        var t = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        var m2 = t.match(/(\d{1,4})/);
        return m2 ? m2[1] : '';
    }

    function collectLateFlightsFromPage() {
        const tables = document.querySelectorAll('table');
        const out = [];
        for (var t = 0; t < tables.length; t++) {
            const table = tables[t];
            if (isNestedInCell(table) || !isOutboundPaxTable(table)) {
                continue;
            }
            const headerTr = findHeaderTr(table);
            if (!headerTr) {
                continue;
            }
            const idx = findFltColumnIndex(headerTr);
            if (idx < 0) {
                continue;
            }
            const trs = table.querySelectorAll('tr');
            for (var r = 0; r < trs.length; r++) {
                const tr = trs[r];
                if (tr === headerTr || tr.querySelector('th')) {
                    continue;
                }
                if (!isLateStyleRow(tr)) {
                    continue;
                }
                const cells = tr.querySelectorAll('td');
                if (cells.length <= idx) {
                    continue;
                }
                const flt = parseFltFromCell(cells[idx]);
                if (flt) {
                    out.push(flt);
                }
            }
        }
        const seen = Object.create(null);
        const unique = [];
        for (var i = 0; i < out.length; i++) {
            if (!seen[out[i]]) {
                seen[out[i]] = true;
                unique.push(out[i]);
            }
        }
        return unique;
    }

    function findWorksheetFlightSearchInput() {
        const host = document.querySelector('div[name="flight"]');
        if (!host) {
            return null;
        }
        return (
            host.querySelector('input.search, input[aria-autocomplete="list"]') ||
            null
        );
    }

    function setFlightAndCommit(input, flight) {
        if (!input) {
            return;
        }
        const el = input;
        try {
            el.focus();
        } catch (e) {}
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
        );
        if (setter && setter.set) {
            setter.set.call(el, String(flight));
        } else {
            el.value = String(flight);
        }
        el.dispatchEvent(
            new Event('input', { bubbles: true, cancelable: true })
        );
        el.dispatchEvent(
            new Event('change', { bubbles: true, cancelable: true })
        );
        try {
            el.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                })
            );
            el.dispatchEvent(
                new KeyboardEvent('keyup', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                })
            );
        } catch (e) {}
    }

    function stepThroughFlights(flights) {
        if (!flights || !flights.length) {
            log('No late flights found. Open Pax connections with the outbound table visible (red or orange row markers).');
            return;
        }
        const delay = stepMs();
        var i = 0;

        function runOne() {
            const input = findWorksheetFlightSearchInput();
            if (!input) {
                log('Worksheet flight field not found. Open the worksheet in another tab or pane and try again.');
                return;
            }
            if (i >= flights.length) {
                log('Done. Applied ' + flights.length + ' flight(s).');
                return;
            }
            const f = flights[i];
            i++;
            setFlightAndCommit(input, f);
            if (i < flights.length) {
                const tid = setTimeout(runOne, delay);
                pendingTimeouts.push(tid);
            } else {
                log('Done. Applied ' + flights.length + ' flight(s).');
            }
        }
        runOne();
    }

    function onPuckClick(e) {
        if (!e.altKey || e.button !== 0) {
            return;
        }
        if (!getPref('paxLateToWsEnabled', true)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const flights = collectLateFlightsFromPage();
        log('Late flights: ' + (flights.length ? flights.join(', ') : '(none)'));
        const t0 = setTimeout(function () {
            stepThroughFlights(flights);
        }, 0);
        pendingTimeouts.push(t0);
    }

    function bindPuck(puck) {
        if (puck.getAttribute && puck.getAttribute(BOUND)) {
            return;
        }
        if (puck.setAttribute) {
            puck.setAttribute(BOUND, '1');
        }
        puckClickHandlers.set(puck, onPuckClick);
        puck.addEventListener('click', onPuckClick, true);
    }

    function scan() {
        document.querySelectorAll(PUCK_SELECTOR).forEach(function (puck) {
            var el = puck.parentElement;
            while (el) {
                if (el.matches && el.matches(PUCK_SELECTOR)) {
                    return;
                }
                el = el.parentElement;
            }
            bindPuck(puck);
        });
    }

    function init() {
        scan();
        mo = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                for (var j = 0; j < m.addedNodes.length; j++) {
                    const node = m.addedNodes[j];
                    if (node.nodeType !== 1) {
                        continue;
                    }
                    if (node.matches && node.matches(PUCK_SELECTOR)) {
                        bindPuck(node);
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll(PUCK_SELECTOR).forEach(bindPuck);
                    }
                }
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    initTimer = setTimeout(init, 800);

    window.__myScriptCleanup = function () {
        if (initTimer) {
            clearTimeout(initTimer);
            initTimer = null;
        }
        while (pendingTimeouts.length) {
            try {
                clearTimeout(pendingTimeouts.pop());
            } catch (e) {}
        }
        if (mo) {
            try {
                mo.disconnect();
            } catch (e) {}
            mo = null;
        }
        document.querySelectorAll('[' + BOUND + ']').forEach(function (puck) {
            const h = puckClickHandlers.get(puck);
            if (h) {
                try {
                    puck.removeEventListener('click', h, true);
                } catch (e) {}
                puckClickHandlers.delete(puck);
            }
            try {
                puck.removeAttribute(BOUND);
            } catch (e) {}
        });
    };
})();
