// ==UserScript==
// @name         Pax connections - late flights
// @namespace    Wolf 2.0
// @version      1.4.0
// @description  Alt+click a flight puck: from Pax for that same leg, queue late (red/orange) outbound rows into the worksheet. Matches /pax-connections/{date}-{dep}-{flight}-… to the window you opened for that leg; other Pax windows are ignored. BroadcastChannel for separate-window Pax.
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"paxLateToWsEnabled":{"type":"boolean","group":"Pax late to worksheet","label":"Enable Alt+click on flight pucks","description":"When on, Alt+left-click a puck finds outbound Pax (FLT) rows for the clicked leg, on red/orange highlights (row/cell class or background) or tight-style rows, then fills the worksheet flight field.","default":true},"paxLateToWsMatchPaxPath":{"type":"boolean","group":"Pax late to worksheet","label":"Match clicked leg to Pax window","description":"Uses the same URL segment as Middle-click Pax: …/pax-connections/{date}-{dep}-{flight}-WN-NULL so only the Pax window opened for that leg is used. Turn off to merge all red/orange rows (legacy, can mix different flights if several Pax popups are open).","default":true},"paxLateToWsAutoOutboundTab":{"type":"boolean","group":"Pax late to worksheet","label":"Click Outbound before scan","description":"Tries to click the Pax 'Outbound' tab in the matching context, then waits so the table can render.","default":true},"paxLateToWsOutboundWaitMs":{"type":"number","group":"Pax late to worksheet","label":"After Outbound click (ms)","description":"How long to wait before reading the table.","default":500,"min":0,"max":5000,"step":50},"paxLateToWsQueryOtherWindows":{"type":"boolean","group":"Pax late to worksheet","label":"Merge from other opssuitemain windows","description":"Query other same-origin windows over BroadcastChannel. With “Match clicked leg” on, only a Pax page whose path matches the clicked leg replies.","default":true},"paxLateToWsBcastTimeoutMs":{"type":"number","group":"Pax late to worksheet","label":"Wait for other windows (ms)","description":"How long to wait for the matching Pax window to reply. Increase if results are still empty.","default":2000,"min":0,"max":10000,"step":100},"paxLateToWsVerboseLog":{"type":"boolean","group":"Pax late to worksheet","label":"Console debug log","description":"Log [PAX-LATE-WS] lines when Alt+clicking. Off by default.","default":false},"paxLateToWsStepMs":{"type":"number","group":"Pax late to worksheet","label":"Delay between flights (ms)","description":"Waits this long after each Enter before the next number.","default":250,"min":0,"max":5000,"step":50}}
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
    /** Same channel name in every opssuitemain tab so Pax-in-popup can answer. */
    var BC_NAME = 'dc_pax_late_flights_v1';
    var bcastChannel = null;

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

    function bcastTimeoutMs() {
        const n = Number(getPref('paxLateToWsBcastTimeoutMs', 2000));
        if (!Number.isFinite(n)) {
            return 2000;
        }
        return Math.min(10000, Math.max(0, Math.floor(n)));
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

    function iframeDocumentListFrom(rootDocument) {
        const base = rootDocument || document;
        const out = [];
        var stack = [];
        var list = base.querySelectorAll
            ? base.querySelectorAll('iframe')
            : [];
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

    function findClickablePaxTab(labelRe, rootDocument) {
        const base = rootDocument || document;
        const roots = [base].concat(iframeDocumentListFrom(base));
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

    function tryClickPaxOutboundTab(cb, rootDocument, paxPathKey) {
        if (!getPref('paxLateToWsAutoOutboundTab', true)) {
            if (cb) {
                cb(false);
            }
            return;
        }
        if (paxPathKey) {
            const rootDoc = rootDocument || document;
            const wk = paxPathKeyFromWindowLocation(rootDoc);
            if (wk !== paxPathKey) {
                if (cb) {
                    cb(false);
                }
                return;
            }
        }
        const btn = findClickablePaxTab(/^outbound$/i, rootDocument);
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
        return iframeDocumentListFrom(document);
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

    /**
     * The Pax URL path is /pax-connections/{date}-{dep}-{flight}-WN-NULL (same as Middle-click launcher).
     * We only scan (or accept broadcast from) a window whose path matches the clicked puck.
     * Logic aligned with findFlightData in Middle-click launcher (sync parts only).
     */
    function extractDateFromLinked(linked) {
        if (linked) {
            const match = linked.match(/^(\d{4}-\d{2}-\d{2})/);
            if (match) {
                return match[1].replace(/-/g, '');
            }
            const compact = linked.match(/^(\d{8})-/);
            if (compact) {
                return compact[1];
            }
        }
        return new Date().toISOString().slice(0, 10).replace(/-/g, '');
    }

    function slugFromGoTurnHref(href) {
        var m = String(href || '').match(/go-turn-details\/([^/?#]+)/i);
        if (!m || !m[1]) {
            return null;
        }
        try {
            return decodeURIComponent(m[1]);
        } catch (e) {
            return m[1];
        }
    }

    function parseGoTurnSlugEnrichment(slug) {
        if (!slug || typeof slug !== 'string') {
            return null;
        }
        var p = slug.split('-');
        if (p.length < 6 || !/^\d{8}$/.test(p[0])) {
            return null;
        }
        return {
            dateCompact: p[0],
            legFlight: /^\d{1,4}$/.test(p[1]) ? p[1] : null,
            depAirport: /^[A-Z]{3}$/.test(p[2]) ? p[2] : null,
            opFlight: p.length > 4 && /^\d{1,4}$/.test(p[4]) ? p[4] : null,
            arrAirport: p.length > 5 && /^[A-Z]{3}$/.test(p[5]) ? p[5] : null
        };
    }

    function parseLinkedHoverRoute(linked) {
        if (!linked || typeof linked !== 'string') {
            return null;
        }
        const parts = linked.split('-');
        if (parts.length < 4) {
            return null;
        }
        var dateCompact;
        var routeParts;
        if (/^\d{8}$/.test(parts[0])) {
            dateCompact = parts[0];
            routeParts = parts.slice(1);
        } else if (
            parts.length >= 9 &&
            /^\d{4}$/.test(parts[0]) &&
            /^\d{2}$/.test(parts[1]) &&
            /^\d{2}$/.test(parts[2])
        ) {
            dateCompact = parts[0] + parts[1] + parts[2];
            routeParts = parts.slice(3);
        } else {
            return null;
        }
        if (routeParts.length < 3) {
            return null;
        }
        var slug = dateCompact + '-' + routeParts.join('-');
        var legFlight = /^\d{1,4}$/.test(routeParts[0]) ? routeParts[0] : null;
        var depAirport = /^[A-Z]{3}$/.test(routeParts[1]) ? routeParts[1] : null;
        var opFlight =
            routeParts.length > 3 && /^\d{1,4}$/.test(routeParts[3])
                ? routeParts[3]
                : legFlight;
        return {
            dateCompact: dateCompact,
            slug: slug,
            legFlight: legFlight,
            depAirport: depAirport,
            opFlight: opFlight || legFlight,
            arrAirport:
                routeParts.length > 4 && /^[A-Z]{3}$/.test(routeParts[4])
                    ? routeParts[4]
                    : null
        };
    }

    function getLinkedHoverIdFromAncestors(el) {
        var cur = el;
        var depth = 0;
        while (cur && depth < 16) {
            if (cur.nodeType === 1 && cur.getAttribute) {
                var v = cur.getAttribute('data-linked-hover-id');
                if (v && String(v).trim()) {
                    return String(v).trim();
                }
            }
            cur = cur.parentElement;
            depth++;
        }
        return '';
    }

    function getLinkedHoverIdForPuck(puck, clickTarget) {
        if (clickTarget && clickTarget.nodeType === 1) {
            var fromClick = getLinkedHoverIdFromAncestors(clickTarget);
            if (fromClick) {
                return fromClick;
            }
        }
        if (puck && puck.querySelector) {
            var d = puck.querySelector('[data-linked-hover-id]');
            if (d) {
                var a = d.getAttribute && d.getAttribute('data-linked-hover-id');
                if (a && String(a).trim()) {
                    return String(a).trim();
                }
            }
        }
        if (puck) {
            return getLinkedHoverIdFromAncestors(puck);
        }
        return '';
    }

    function extractGoTurnSlugFromDom(puck) {
        if (!puck) {
            return null;
        }
        var cur = puck;
        var depth = 0;
        while (cur && depth < 16) {
            if (cur.querySelectorAll) {
                var nodes = cur.querySelectorAll('a[href*="go-turn-details"]');
                var i;
                for (i = 0; i < nodes.length; i++) {
                    var sl = slugFromGoTurnHref(
                        nodes[i].getAttribute('href') || nodes[i].href
                    );
                    if (sl) {
                        return sl;
                    }
                }
            }
            cur = cur.parentElement;
            depth++;
        }
        return null;
    }

    function buildGoTurnSlugFallback(data) {
        var leg = data.legFlight || data.flight;
        var op = data.opFlight || data.flight;
        var dep = data.depAirport;
        var arr = data.arrAirport;
        if (!arr || !/^[A-Z]{3}$/.test(arr)) {
            arr = 'NULL';
        }
        if (!data.date || !leg || !dep || !op) {
            return null;
        }
        return (
            data.date +
            '-' +
            leg +
            '-' +
            dep +
            '-NULL-' +
            op +
            '-' +
            arr +
            '-NULL'
        );
    }

    function findFlightDataFromPuck(puck, clickTarget) {
        if (!puck) {
            return null;
        }
        var linkedRaw = getLinkedHoverIdForPuck(puck, clickTarget);
        var fromLink = parseLinkedHoverRoute(linkedRaw);
        var domSlug = extractGoTurnSlugFromDom(puck);
        if (fromLink && fromLink.slug && domSlug && domSlug !== fromLink.slug) {
            domSlug = null;
        }
        var slugForEnrich = (fromLink && fromLink.slug) || domSlug;
        var fromDom = slugForEnrich
            ? parseGoTurnSlugEnrichment(slugForEnrich)
            : null;
        const stationNodes = puck.querySelectorAll('[class*="tg9Iiv9oAOo="]');
        const airports = Array.from(stationNodes)
            .map(function (n) {
                return n.textContent.trim();
            })
            .filter(function (txt) {
                return /^[A-Z]{3}$/.test(txt);
            });
        var depAirport =
            airports[0] ||
            (fromLink && fromLink.depAirport) ||
            (fromDom && fromDom.depAirport) ||
            null;
        var arrAirport =
            airports[1] ||
            (fromLink && fromLink.arrAirport) ||
            (fromDom && fromDom.arrAirport) ||
            null;
        var flight = null;
        const flightWrapper = puck.querySelector('[class*="u8OLVYUVzvY="]');
        if (flightWrapper) {
            const spanFlight = flightWrapper.querySelector('span');
            if (
                spanFlight &&
                /^\d{1,4}$/.test(spanFlight.textContent.trim())
            ) {
                flight = spanFlight.textContent.trim();
            }
            if (!flight) {
                const divFlight = flightWrapper.querySelector(
                    '[class*="tw9pR6Lavy8="]'
                );
                if (
                    divFlight &&
                    /^\d{1,4}$/.test(divFlight.textContent.trim())
                ) {
                    flight = divFlight.textContent.trim();
                }
            }
        }
        if (!flight) {
            const match = linkedRaw && linkedRaw.match(/^\d{4}-\d{2}-\d{2}-(\d+)-/);
            if (match) {
                flight = match[1];
            }
        }
        if (!flight && fromLink && fromLink.opFlight) {
            flight = fromLink.opFlight;
        }
        if (!flight && fromLink && fromLink.legFlight) {
            flight = fromLink.legFlight;
        }
        if (!flight && fromDom) {
            flight = fromDom.opFlight || fromDom.legFlight;
        }
        if (!/^\d+$/.test(flight)) {
            flight = null;
        }
        var legFlight =
            (fromLink && fromLink.legFlight) ||
            (fromDom && fromDom.legFlight) ||
            flight;
        var opFlight =
            (fromLink && fromLink.opFlight) || (fromDom && fromDom.opFlight) || flight;
        var date =
            (fromLink && fromLink.dateCompact) ||
            (fromDom && fromDom.dateCompact) ||
            extractDateFromLinked(linkedRaw);
        if (!depAirport || !flight) {
            return null;
        }
        return {
            depAirport: depAirport || '',
            arrAirport: arrAirport,
            flight: flight || '',
            legFlight: legFlight || flight,
            opFlight: opFlight || flight,
            date: date
        };
    }

    /**
     * Canonical key: YYYYMMDD-DEP-NNNN — must match first segment of pathname after
     * /pax-connections/ (Pax "open for this leg").
     */
    function buildPaxPathKeyFromFlightData(fd) {
        if (!fd || !fd.flight || !fd.depAirport || !fd.date) {
            return null;
        }
        if (!/^\d{8}$/.test(String(fd.date))) {
            return null;
        }
        if (!/^[A-Z]{3}$/.test(String(fd.depAirport || '').toUpperCase())) {
            return null;
        }
        if (!/^\d{1,4}$/.test(String(fd.flight))) {
            return null;
        }
        return (
            fd.date + '-' + String(fd.depAirport).toUpperCase() + '-' + String(fd.flight)
        );
    }

    function paxPathKeyFromWindowLocation(doc) {
        var d = doc || document;
        var loc;
        try {
            loc = d && d.defaultView && d.defaultView.location
                ? d.defaultView.location
                : null;
        } catch (e) {
            return '';
        }
        if (!loc || !loc.pathname) {
            return '';
        }
        var p = (loc.pathname || '').toLowerCase();
        var needle = '/pax-connections/';
        var idx = p.indexOf(needle);
        if (idx < 0) {
            return '';
        }
        var rest = p.slice(idx + needle.length);
        if (rest.indexOf('/') >= 0) {
            rest = rest.split('/')[0];
        }
        var segs = rest.split('-');
        if (segs.length < 3) {
            return '';
        }
        if (!/^\d{8}$/.test(segs[0])) {
            return '';
        }
        if (!/^[a-z]{3}$/i.test(segs[1]) || !/^\d{1,4}$/.test(segs[2])) {
            return '';
        }
        return segs[0] + '-' + segs[1].toUpperCase() + '-' + segs[2];
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

    function collectLateFlightsFromPageForRoot(rootDocument, paxPathKey) {
        const base = rootDocument || document;
        if (paxPathKey) {
            var wk0 = paxPathKeyFromWindowLocation(base);
            if (wk0 && wk0 !== paxPathKey) {
                return [];
            }
        }
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
        mergePart(collectLateFlightsFromRoot(base));
        const ifrDocs = iframeDocumentListFrom(base);
        var d;
        for (d = 0; d < ifrDocs.length; d++) {
            mergePart(collectLateFlightsFromRoot(ifrDocs[d]));
        }
        return unique;
    }

    function collectLateFlightsFromPage() {
        return collectLateFlightsFromPageForRoot(document);
    }

    var pendingBcastById = Object.create(null);

    function randomBcastId() {
        return String(Date.now()) + '-' + String(Math.random()).slice(2, 11);
    }

    function mergeFlightsUniqueInto(uniq, part) {
        if (!part || !part.length) {
            return;
        }
        const seen = Object.create(null);
        for (var i = 0; i < uniq.length; i++) {
            seen[uniq[i]] = true;
        }
        for (i = 0; i < part.length; i++) {
            if (!seen[part[i]]) {
                seen[part[i]] = true;
                uniq.push(part[i]);
            }
        }
    }

    function isLikelyPaxConnectionsPage() {
        try {
            const p = (location.pathname || '').toLowerCase();
            if (p.indexOf('pax-connections') >= 0) {
                return true;
            }
        } catch (e) {}
        return false;
    }

    function paxBcastOnMessage(ev) {
        const ch = ensureBcastChannel();
        const d = ev && ev.data;
        if (!d || ch !== bcastChannel) {
            return;
        }
        if (d.t === 'q' && d.id) {
            if (!isLikelyPaxConnectionsPage()) {
                return;
            }
            if (d.paxPathKey) {
                var wkR = paxPathKeyFromWindowLocation(document);
                if (!wkR || wkR !== d.paxPathKey) {
                    return;
                }
            }
            if (!getPref('paxLateToWsEnabled', true)) {
                try {
                    bcastChannel.postMessage({
                        t: 'r',
                        id: d.id,
                        flights: [],
                        paxPathKey: d.paxPathKey || null
                    });
                } catch (e) {}
                return;
            }
            const reqId = d.id;
            const rKey = d.paxPathKey || null;
            tryClickPaxOutboundTab(
                function () {
                    const list = collectLateFlightsFromPageForRoot(
                        document,
                        rKey
                    );
                    try {
                        if (bcastChannel) {
                            bcastChannel.postMessage({
                                t: 'r',
                                id: reqId,
                                flights: list,
                                paxPathKey: rKey
                            });
                        }
                    } catch (e) {}
                },
                document,
                rKey
            );
            return;
        }
        if (d.t === 'r' && d.id) {
            const st = pendingBcastById[d.id];
            if (!st) {
                return;
            }
            if (st.paxPathKey) {
                if (d.paxPathKey && d.paxPathKey !== st.paxPathKey) {
                    return;
                }
            }
            if (d.flights && d.flights.length) {
                mergeFlightsUniqueInto(st.list, d.flights);
            }
        }
    }

    function ensureBcastChannel() {
        if (bcastChannel) {
            return bcastChannel;
        }
        if (typeof BroadcastChannel === 'undefined') {
            return null;
        }
        try {
            bcastChannel = new BroadcastChannel(BC_NAME);
            bcastChannel.addEventListener('message', paxBcastOnMessage);
        } catch (e) {
            bcastChannel = null;
        }
        return bcastChannel;
    }

    function requestLateFlightsFromOtherWindows(localList, paxPathKey, onDone) {
        if (!getPref('paxLateToWsQueryOtherWindows', true)) {
            onDone(localList);
            return;
        }
        const ch = ensureBcastChannel();
        if (!ch) {
            onDone(localList);
            return;
        }
        const wait = bcastTimeoutMs();
        if (wait <= 0) {
            onDone(localList);
            return;
        }
        const id = randomBcastId();
        const st = { list: [], paxPathKey: paxPathKey || null };
        mergeFlightsUniqueInto(st.list, localList);
        st.timer = setTimeout(function () {
            if (pendingBcastById[id] === st) {
                delete pendingBcastById[id];
            }
            try {
                onDone(st.list);
            } catch (e) {}
        }, wait);
        pendingBcastById[id] = st;
        var payload = { t: 'q', id: id };
        if (paxPathKey) {
            payload.paxPathKey = paxPathKey;
        }
        try {
            ch.postMessage(payload);
        } catch (e) {
            if (pendingBcastById[id] === st) {
                try {
                    clearTimeout(st.timer);
                } catch (e2) {}
                delete pendingBcastById[id];
            }
            onDone(st.list);
        }
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

    function onPuckClick(e, puck) {
        if (!e.altKey || e.button !== 0) {
            return;
        }
        if (!getPref('paxLateToWsEnabled', true)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        var wantMatch = getPref('paxLateToWsMatchPaxPath', true);
        var paxPathKey = null;
        if (wantMatch) {
            var fd = findFlightDataFromPuck(puck, e.target);
            if (!fd) {
                log('Could not read dep/flight for the clicked leg (puck). Open Pax for this same leg (Middle-click) or turn off "Match clicked leg" in script prefs.');
                setTimeout(function () {
                    stepThroughFlights([]);
                }, 0);
                return;
            }
            paxPathKey = buildPaxPathKeyFromFlightData(fd);
            if (!paxPathKey) {
                log('Could not build Pax window key (need yyyymmdd, dep, flight on puck).');
                setTimeout(function () {
                    stepThroughFlights([]);
                }, 0);
                return;
            }
            log('Clicked leg key ' + paxPathKey + ' (only this Pax page window is used).');
        }
        tryClickPaxOutboundTab(
            function () {
                const local = collectLateFlightsFromPageForRoot(
                    document,
                    paxPathKey
                );
                log('Local late flights: ' + (local.length ? local.join(', ') : '(none)'));
                requestLateFlightsFromOtherWindows(
                    local,
                    paxPathKey,
                    function (flights) {
                        log(
                            'Merged late flights: ' +
                            (flights.length ? flights.join(', ') : '(none)')
                        );
                        const t0 = setTimeout(function () {
                            stepThroughFlights(flights);
                        }, 0);
                        pendingTimeouts.push(t0);
                    }
                );
            },
            document,
            paxPathKey
        );
    }

    function bindPuck(puck) {
        if (puck.getAttribute && puck.getAttribute(BOUND)) {
            return;
        }
        if (puck.setAttribute) {
            puck.setAttribute(BOUND, '1');
        }
        var handler = function (ev) {
            onPuckClick(ev, puck);
        };
        puckClickHandlers.set(puck, handler);
        puck.addEventListener('click', handler, true);
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

    initTimer = setTimeout(function () {
        ensureBcastChannel();
        init();
    }, 800);

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
        var bId;
        for (bId in pendingBcastById) {
            if (Object.prototype.hasOwnProperty.call(pendingBcastById, bId)) {
                const st = pendingBcastById[bId];
                if (st && st.timer) {
                    try {
                        clearTimeout(st.timer);
                    } catch (e) {}
                }
            }
        }
        pendingBcastById = Object.create(null);
        if (bcastChannel) {
            try {
                bcastChannel.removeEventListener('message', paxBcastOnMessage);
                bcastChannel.close();
            } catch (e) {}
            bcastChannel = null;
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
