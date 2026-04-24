// ==UserScript==
// @name         Pax connections - late flights
// @namespace    Wolf 2.0
// @version      1.2.0
// @description  Alt+click a flight puck: from Pax connections outbound, queue late (red/orange) rows into the worksheet flight field. Scans main page + iframes; optional auto Outbound tab.
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"paxLateToWsEnabled":{"type":"boolean","group":"Pax late to worksheet","label":"Enable Alt+click on flight pucks","description":"When on, Alt+left-click a puck finds outbound Pax (FLT) rows on red/orange highlights (row/cell class or background) or tight-style rows, then fills the worksheet flight field.","default":true},"paxLateToWsAutoOutboundTab":{"type":"boolean","group":"Pax late to worksheet","label":"Click Outbound before scan","description":"Tries to click the Pax 'Outbound' tab in the same window, then waits so the table can render (reduces need to open the tab yourself).","default":true},"paxLateToWsOutboundWaitMs":{"type":"number","group":"Pax late to worksheet","label":"After Outbound click (ms)","description":"How long to wait before reading the table.","default":500,"min":0,"max":5000,"step":50},"paxLateToWsVerboseLog":{"type":"boolean","group":"Pax late to worksheet","label":"Console debug log","description":"Log [PAX-LATE-WS] lines when Alt+clicking. Off by default.","default":false},"paxLateToWsStepMs":{"type":"number","group":"Pax late to worksheet","label":"Delay between flights (ms)","description":"Waits this long after each Enter before the next number.","default":250,"min":0,"max":5000,"step":50}}
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

    function outboundWaitMs() {
        const n = Number(getPref('paxLateToWsOutboundWaitMs', 500));
        if (!Number.isFinite(n)) {
            return 500;
        }
        return Math.min(5000, Math.max(0, Math.floor(n)));
    }

    function isVisibleForClick(el) {
        if (!el) {
            return false;
        }
        var r = el.getBoundingClientRect
            ? el.getBoundingClientRect()
            : { width: 0, height: 0 };
        return r.width > 1 && r.height > 1;
    }

    function findClickablePaxTab(labelRe) {
        const roots = [document].concat(iframeDocumentList());
        var ri;
        for (ri = 0; ri < roots.length; ri++) {
            var root = roots[ri];
            if (!root || !root.querySelectorAll) {
                continue;
            }
            var cands = root.querySelectorAll(
                'button, a, [role="button"], [role="tab"]'
            );
            var j;
            for (j = 0; j < cands.length; j++) {
                const el = cands[j];
                if (!isVisibleForClick(el)) {
                    continue;
                }
                const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (!t || t.length > 32) {
                    continue;
                }
                if (labelRe.test(t)) {
                    return el;
                }
            }
        }
        return null;
    }

    function tryClickPaxOutboundTab(cb) {
        if (!getPref('paxLateToWsAutoOutboundTab', true)) {
            if (cb) {
                cb(false);
            }
            return;
        }
        const btn = findClickablePaxTab(/^outbound$/i);
        if (!btn) {
            if (cb) {
                cb(false);
            }
            return;
        }
        try {
            log('Clicking Outbound tab');
            btn.click();
        } catch (e) {
            if (cb) {
                cb(false);
            }
            return;
        }
        const ms = outboundWaitMs();
        if (ms > 0) {
            const tid = setTimeout(function () {
                if (cb) {
                    cb(true);
                }
            }, ms);
            pendingTimeouts.push(tid);
        } else if (cb) {
            cb(true);
        }
    }

    function iframeDocumentList() {
        const out = [];
        var stack = [];
        var list = document.querySelectorAll('iframe');
        var k;
        for (k = 0; k < list.length; k++) {
            stack.push(list[k]);
        }
        while (stack.length) {
            const fr = stack.pop();
            var doc;
            try {
                doc = fr && fr.contentDocument;
            } catch (e) {
                continue;
            }
            if (doc) {
                out.push(doc);
                if (doc.querySelectorAll) {
                    var inners = doc.querySelectorAll('iframe');
                    for (k = 0; k < inners.length; k++) {
                        stack.push(inners[k]);
                    }
                }
            }
        }
        return out;
    }

    function log() {
        if (!getPref('paxLateToWsVerboseLog', false)) {
            return;
        }
        console.log.apply(
            console,
            ['%c[PAX-LATE-WS]', 'color:#e67e22'].concat([].slice.call(arguments))
        );
    }

    function parseNumericTriplet(s) {
        var p = /rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(
            String(s || '')
        );
        if (!p) {
            return null;
        }
        var r = Math.round(Math.min(255, Math.max(0, Number(p[1]))));
        var g = Math.round(Math.min(255, Math.max(0, Number(p[2]))));
        var b = Math.round(Math.min(255, Math.max(0, Number(p[3]))));
        if (!Number.isFinite(r + g + b)) {
            return null;
        }
        return { r: r, g: g, b: b };
    }

    function rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        var max = Math.max(r, g, b);
        var min = Math.min(r, g, b);
        var h = 0;
        var s = 0;
        var l = (max + min) / 2;
        if (max !== min) {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                default:
                    h = (r - g) / d + 4;
            }
            h *= 60;
        }
        return { h: h, s: s, l: l };
    }

    function isRedOrOrangeBackground(rgb) {
        if (!rgb) {
            return false;
        }
        var r = rgb.r;
        var g = rgb.g;
        var b = rgb.b;
        if (r + g + b < 32) {
            return false;
        }
        if (g > 210 && b > 210) {
            return false;
        }
        if (r > g + 20 && r > b + 15 && r > 40) {
            if (g < 160 && b < 160) {
                return true;
            }
        }
        if (r > 90 && g > 50 && b < 130 && r - b > 20) {
            return true;
        }
        var hsl = rgbToHsl(r, g, b);
        if (hsl.l < 0.08 || hsl.l > 0.97) {
            return false;
        }
        if (hsl.s < 0.1) {
            return false;
        }
        if (hsl.h < 18 || hsl.h > 352) {
            return hsl.s >= 0.14;
        }
        if (hsl.h >= 10 && hsl.h <= 58) {
            return hsl.s >= 0.12;
        }
        return false;
    }

    function elementBackgroundLooksAlert(el) {
        if (!el || el.nodeType !== 1) {
            return false;
        }
        var st;
        try {
            st = (el.ownerDocument && el.ownerDocument.defaultView
                ? el.ownerDocument.defaultView
                : window
            ).getComputedStyle(el);
        } catch (e) {
            return false;
        }
        if (!st) {
            return false;
        }
        if (
            String(st.backgroundImage || '')
                .toLowerCase()
                .indexOf('gradient') >= 0
        ) {
            return true;
        }
        var tri = parseNumericTriplet(st.backgroundColor);
        if (isRedOrOrangeBackground(tri)) {
            return true;
        }
        var bLeft = st.borderLeftColor;
        if (bLeft) {
            var tri2 = parseNumericTriplet(bLeft);
            if (isRedOrOrangeBackground(tri2)) {
                return true;
            }
        }
        return false;
    }

    function rowHasRedOrOrangeTableBackground(tr) {
        if (!tr || tr.nodeName !== 'TR') {
            return false;
        }
        if (elementBackgroundLooksAlert(tr)) {
            return true;
        }
        var tds = tr.querySelectorAll('td');
        for (var i = 0; i < tds.length; i++) {
            if (elementBackgroundLooksAlert(tds[i])) {
                return true;
            }
        }
        return false;
    }

    function isNestedInCell(table) {
        return !!(table && table.closest && table.closest('td, th'));
    }

    function thTextNorm(th) {
        return th && th.textContent
            ? th.textContent.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
            : '';
    }

    function isOutboundPaxTable(table) {
        if (!table) {
            return false;
        }
        const rows = table.querySelectorAll('tr');
        var r;
        for (r = 0; r < rows.length; r++) {
            const ths = rows[r].querySelectorAll('th');
            if (ths.length < 6) {
                continue;
            }
            const parts = [];
            var j;
            for (j = 0; j < ths.length; j++) {
                parts.push(thTextNorm(ths[j]));
            }
            const joined = parts.join(' ');
            if (parts.indexOf('FLT') < 0) {
                continue;
            }
            if (joined.indexOf('NEXT') < 0 && joined.indexOf('FINAL') < 0) {
                continue;
            }
            return true;
        }
        return false;
    }

    function findHeaderTr(table) {
        const rows = table.querySelectorAll('tr');
        for (var r = 0; r < rows.length; r++) {
            if (!rows[r].querySelector('th')) {
                continue;
            }
            const ths = rows[r].querySelectorAll('th');
            var hasFlt = false;
            var j;
            for (j = 0; j < ths.length; j++) {
                if (thTextNorm(ths[j]) === 'FLT') {
                    hasFlt = true;
                    break;
                }
            }
            if (hasFlt) {
                return rows[r];
            }
        }
        return null;
    }

    function findFltColumnIndex(tr) {
        const ths = tr.querySelectorAll('th');
        for (var i = 0; i < ths.length; i++) {
            if (thTextNorm(ths[i]) === 'FLT') {
                return i;
            }
        }
        return -1;
    }

    function rowHasRedOrOrangeExclamation(tr) {
        if (!tr || tr.nodeName !== 'TR') {
            return false;
        }
        const list = tr.querySelectorAll('i, svg, [class*="exclamation"]');
        for (var i = 0; i < list.length; i++) {
            const ic = ' ' + String(list[i].className && list[i].className.baseVal !== undefined
                ? list[i].className.baseVal
                : list[i].className || '') + ' ';
            if (ic.indexOf('exclamation') < 0) {
                continue;
            }
            if (ic.indexOf(' red ') >= 0 || ic.indexOf(' orange ') >= 0) {
                return true;
            }
        }
        return false;
    }

    function classNameLooksAlertClass(el) {
        var c = el && (el.getAttribute('class') || (el.className && String(el.className)));
        c = String(c || '');
        if (!c) {
            return false;
        }
        if (c.indexOf('inverted') >= 0) {
            return false;
        }
        if (/(^|\s)red(\s|$)/.test(c) || /(^|\s)orange(\s|$)/.test(c)) {
            return true;
        }
        if (c.indexOf('negative') >= 0 || c.indexOf('warning') >= 0) {
            return true;
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

    function rowOrDescendantClassLooksAlert(tr) {
        if (!tr) {
            return false;
        }
        if (classNameLooksAlertClass(tr)) {
            return true;
        }
        var tds = tr.querySelectorAll('td');
        var t;
        for (t = 0; t < tds.length; t++) {
            if (classNameLooksAlertClass(tds[t])) {
                return true;
            }
        }
        if (tr.querySelector('i.red, i.orange, [class~="red"], [class~="orange"]')) {
            return true;
        }
        return false;
    }

    function isLateStyleRow(tr) {
        return (
            rowHasRedOrOrangeExclamation(tr) ||
            isTightPaxRow(tr) ||
            rowOrDescendantClassLooksAlert(tr) ||
            rowHasRedOrOrangeTableBackground(tr)
        );
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

    function collectLateFlightsFromRoot(root) {
        if (!root || !root.querySelectorAll) {
            return [];
        }
        const tables = root.querySelectorAll('table');
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
        return out;
    }

    function collectLateFlightsFromPage() {
        const seen = Object.create(null);
        const unique = [];
        function mergePart(part) {
            if (!part || !part.length) {
                return;
            }
            var i;
            for (i = 0; i < part.length; i++) {
                if (!seen[part[i]]) {
                    seen[part[i]] = true;
                    unique.push(part[i]);
                }
            }
        }
        mergePart(collectLateFlightsFromRoot(document));
        const ifrDocs = iframeDocumentList();
        var d;
        for (d = 0; d < ifrDocs.length; d++) {
            mergePart(collectLateFlightsFromRoot(ifrDocs[d]));
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
        tryClickPaxOutboundTab(function () {
            const flights = collectLateFlightsFromPage();
            log('Late flights: ' + (flights.length ? flights.join(', ') : '(none)'));
            const t0 = setTimeout(function () {
                stepThroughFlights(flights);
            }, 0);
            pendingTimeouts.push(t0);
        });
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
