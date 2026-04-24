// ==UserScript==
// @name         Pax connections - late flights
// @namespace    Wolf 2.0
// @version      1.8.2
// @description  Tight pax, per-block send. Alt+click opens Pax in a real popup (like middle-click) and refocuses the worksheet if preferred.
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"paxLateToWsEnabled":{"type":"boolean","group":"Pax late to worksheet","label":"Enable Alt+click on flight pucks","default":true},"paxLateToWsOpenPaxWindow":{"type":"boolean","group":"Pax late to worksheet","label":"Open Pax on Alt+click","default":true,"description":"Opens a separate browser window (not a tab) when the popup options below are used."},"paxLateToWsPaxAsPopupWindow":{"type":"boolean","group":"Pax late to worksheet · open Pax","label":"Pax in popup (not new tab)","default":true,"description":"Uses window features (size/position) like Middle-click launcher, so the worksheet can stay the focused tab."},"paxLateToWsPaxRefocusOpener":{"type":"boolean","group":"Pax late to worksheet · open Pax","label":"Refocus this window after open","default":true,"description":"Call window.focus() on the schedule/worksheet window after opening Pax (best-effort; browser may still show the popup on top)."},"paxLateToWsPaxWinW":{"type":"number","group":"Pax late to worksheet · open Pax","label":"Popup width (px)","default":1000,"min":400,"max":2400,"step":10},"paxLateToWsPaxWinH":{"type":"number","group":"Pax late to worksheet · open Pax","label":"Popup height (px)","default":800,"min":400,"max":2000,"step":10},"paxLateToWsPaxWinLeft":{"type":"number","group":"Pax late to worksheet · open Pax","label":"Popup left offset from this window (px)","default":24,"min":-2000,"max":2000,"step":1},"paxLateToWsPaxWinTop":{"type":"number","group":"Pax late to worksheet · open Pax","label":"Popup top offset (px)","default":24,"min":0,"max":2000,"step":1},"paxLateToWsPaxWindowName":{"type":"string","group":"Pax late to worksheet · open Pax","label":"Reusable window name","default":"__dcPaxLateFlightsPax__","description":"If another Pax from this control is already using this name, the same window may navigate (browser dependent). Use a new name to always get a new popup."},"paxLateToWsAfterOpenWaitMs":{"type":"number","group":"Pax late to worksheet","label":"After open Pax, wait (ms)","default":2000,"min":0,"max":20000,"step":100},"paxLateToWsPaxInlineSend":{"type":"boolean","group":"Pax late to worksheet","label":"Pax: inline send by connection","default":true,"description":"Insert a Send control next to SCH ARR/ETA; remembers worksheet per IATA in local storage."},"paxLateToWsWorksheetPicker":{"type":"boolean","group":"Pax late to worksheet","label":"Ask which worksheet (multi-tab)","default":true},"paxLateToWsListWorksheetsMs":{"type":"number","group":"Pax late to worksheet","label":"Worksheet list wait (ms)","default":500,"min":200,"max":2000,"step":50},"paxLateToWsMatchPaxPath":{"type":"boolean","group":"Pax late to worksheet","label":"Match leg to Pax URL","default":true},"paxLateToWsTightByTime":{"type":"boolean","group":"Pax late to worksheet · time","label":"Tight = ETD within gap of ref ETA","default":true},"paxLateToWsTightMaxGapMin":{"type":"number","group":"Pax late to worksheet · time","label":"Max minutes (ETD after ref ETA)","default":20,"min":0,"max":300,"step":1},"paxLateToWsTightTimeOrColor":{"type":"boolean","group":"Pax late to worksheet · time","label":"OR include red/orange rows","default":true},"paxLateToWsDownlineColumn":{"type":"select","group":"Pax late to worksheet","label":"IATA filter column","default":"off","options":[{"value":"off","label":"No IATA filter"},{"value":"final","label":"FINAL only"},{"value":"next","label":"NEXT only"},{"value":"next_or_final","label":"NEXT or FINAL"}]},"paxLateToWsDownlineIata":{"type":"string","group":"Pax late to worksheet","label":"IATA list","default":"","placeholder":"e.g. MSP"},"paxLateToWsAutoOutboundTab":{"type":"boolean","group":"Pax late to worksheet","label":"Click Outbound first","default":true},"paxLateToWsOutboundWaitMs":{"type":"number","group":"Pax late to worksheet","label":"After Outbound (ms)","default":500,"min":0,"max":5000,"step":50},"paxLateToWsQueryOtherWindows":{"type":"boolean","group":"Pax late to worksheet","label":"Broadcast from Pax to worksheet","default":true},"paxLateToWsBcastTimeoutMs":{"type":"number","group":"Pax late to worksheet","label":"Pax reply wait (ms)","default":2000,"min":0,"max":10000,"step":100},"paxLateToWsVerboseLog":{"type":"boolean","group":"Pax late to worksheet","label":"Debug log","default":false},"paxLateToWsStepMs":{"type":"number","group":"Pax late to worksheet","label":"Enter delay (ms)","default":250,"min":0,"max":5000,"step":50}}
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
    var BC_WS_NAME = 'dc_pax_late_to_ws_v1';
    var WS_TAB_ID_KEY = 'dcPaxLateWsTabId';
    var bcastChannel = null;
    var wsChannel = null;
    var worksheetTabId = null;
    var wsTitleObserver = null;
    var worksheetPickerOverlay = null;
    var paxBlockMo = null;
    const LS_WS_BY_CONN = 'paxLateWsByConnTabIdByIataV1';

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

    function afterOpenPaxWaitMs() {
        const n = Number(getPref('paxLateToWsAfterOpenWaitMs', 2000));
        if (!Number.isFinite(n)) {
            return 2000;
        }
        return Math.min(20000, Math.max(0, Math.floor(n)));
    }

    function numPref(key, def, lo, hi) {
        const n = Number(getPref(key, def));
        if (!Number.isFinite(n)) {
            return def;
        }
        return Math.min(hi, Math.max(lo, n));
    }

    function openPaxInSeparateWindow(paxUrl) {
        if (!paxUrl) {
            return null;
        }
        if (getPref('paxLateToWsPaxAsPopupWindow', true) === false) {
            try {
                return window.open(paxUrl, '_blank', 'noopener');
            } catch (e) {
                return null;
            }
        }
        const w = numPref('paxLateToWsPaxWinW', 1000, 400, 2400);
        const h = numPref('paxLateToWsPaxWinH', 800, 400, 2000);
        const ox = numPref('paxLateToWsPaxWinLeft', 24, -2000, 2000);
        const oy = numPref('paxLateToWsPaxWinTop', 24, 0, 2000);
        var left = 0;
        var top = 0;
        try {
            const sx = typeof window.screenX === 'number' ? window.screenX : 0;
            const sy = typeof window.screenY === 'number' ? window.screenY : 0;
            left = Math.round(sx + ox);
            top = Math.round(sy + oy);
            if (left < 0) {
                left = 0;
            }
            if (top < 0) {
                top = 0;
            }
        } catch (e) {
            left = Math.max(0, Math.round(ox + 100));
            top = Math.max(0, Math.round(oy + 100));
        }
        var wname = String(
            (getPref('paxLateToWsPaxWindowName', '__dcPaxLateFlightsPax__') ||
            '')
        );
        wname = wname.replace(/^\s+|\s+$/g, '');
        if (!wname) {
            wname = 'dcPaxLateW_' + String(Date.now());
        }
        const features =
            'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes,toolbar=no,location=yes,status=no,menubar=no';
        var win;
        try {
            win = window.open(paxUrl, wname, features);
        } catch (e) {
            win = null;
        }
        if (getPref('paxLateToWsPaxRefocusOpener', true) !== false) {
            const refocus = function () {
                try {
                    if (window && window.focus) {
                        window.focus();
                    }
                } catch (e2) {}
            };
            try {
                if (window.requestAnimationFrame) {
                    requestAnimationFrame(function () {
                        setTimeout(refocus, 0);
                    });
                } else {
                    setTimeout(refocus, 0);
                }
            } catch (e) {
                setTimeout(refocus, 0);
            }
        }
        return win;
    }

    function getDownlineColumnMode() {
        const v = getPref('paxLateToWsDownlineColumn', 'off');
        if (v === 'final' || v === 'next' || v === 'next_or_final' || v === 'off') {
            return v;
        }
        return 'off';
    }

    function parseDownlineIataListFromString(raw) {
        if (!raw || typeof raw !== 'string') {
            return [];
        }
        return String(raw)
            .split(/[\s,;]+/)
            .map(function (s) {
                return s.replace(/^\s+|\s+$/g, '');
            })
            .filter(function (s) {
                return /^[A-Z]{3}$/i.test(s);
            })
            .map(function (s) {
                return s.toUpperCase();
            });
    }

    function defTightByTime() {
        return getPref('paxLateToWsTightByTime', true) !== false;
    }

    function defTightMaxGapMin() {
        const n = Number(getPref('paxLateToWsTightMaxGapMin', 20));
        if (!Number.isFinite(n)) {
            return 20;
        }
        return Math.min(300, Math.max(0, n));
    }

    function defTightTimeOrColor() {
        return getPref('paxLateToWsTightTimeOrColor', true) !== false;
    }

    function normalizeCollectOpts(obj) {
        if (!obj) {
            return {
                downlineMode: getDownlineColumnMode(),
                downlineIataList: parseDownlineIataListFromString(
                    getPref('paxLateToWsDownlineIata', '') || ''
                ),
                tightByTime: defTightByTime(),
                tightMaxGapMin: defTightMaxGapMin(),
                tightTimeOrColor: defTightTimeOrColor(),
                refFlt: null
            };
        }
        const mode =
            obj.downlineMode !== undefined && obj.downlineMode !== null
                ? obj.downlineMode
                : getDownlineColumnMode();
        const list = Array.isArray(obj.downlineIataList)
            ? obj.downlineIataList
            : parseDownlineIataListFromString(
                  String(obj.downlineIataRaw || obj.downlineIata || '')
              );
        const tbt =
            obj.tightByTime !== undefined && obj.tightByTime !== null
                ? obj.tightByTime
                : defTightByTime();
        const tgm =
            obj.tightMaxGapMin !== undefined && obj.tightMaxGapMin !== null
                ? Number(obj.tightMaxGapMin)
                : defTightMaxGapMin();
        const ttc =
            obj.tightTimeOrColor !== undefined && obj.tightTimeOrColor !== null
                ? obj.tightTimeOrColor
                : defTightTimeOrColor();
        var rrf = null;
        if (obj.refFlt !== undefined && obj.refFlt !== null && obj.refFlt !== '') {
            rrf = String(obj.refFlt);
        }
        return {
            downlineMode: mode,
            downlineIataList: list,
            tightByTime: !!tbt,
            tightMaxGapMin: Number.isFinite(tgm) ? tgm : defTightMaxGapMin(),
            tightTimeOrColor: !!ttc,
            refFlt: rrf
        };
    }

    function refFlightDigitsFromPaxPathKey(paxPathKey) {
        if (!paxPathKey || typeof paxPathKey !== 'string') {
            return null;
        }
        const p = paxPathKey.split('-');
        if (p.length < 3) {
            return null;
        }
        if (!/^\d{1,4}$/.test(p[2])) {
            return null;
        }
        return p[2];
    }

    function collectOptsKey(co) {
        if (!co) {
            return '';
        }
        return [
            String(co.downlineMode || 'off'),
            (co.downlineIataList || []).join(','),
            co.tightByTime ? '1' : '0',
            String(co.tightMaxGapMin),
            co.tightTimeOrColor ? '1' : '0',
            String(co.refFlt || '')
        ].join('|');
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
                cb(true);
            }
            return;
        }
        if (paxPathKey) {
            const rootDoc = rootDocument || document;
            const wk = paxPathKeyFromWindowLocation(rootDoc);
            if (wk !== paxPathKey) {
                if (cb) {
                    cb(true);
                }
                return;
            }
        }
        const btn = findClickablePaxTab(/^outbound$/i, rootDocument);
        if (!btn) {
            if (cb) {
                cb(true);
            }
            return;
        }
        try {
            log('Clicking Outbound tab');
            btn.click();
        } catch (e) {
            if (cb) {
                cb(true);
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

    function buildPaxUrlForFlightData(fd) {
        if (!buildPaxPathKeyFromFlightData(fd)) {
            return null;
        }
        return (
            'https://opssuitemain.swacorp.com/pax-connections/' +
            fd.date +
            '-' +
            String(fd.depAirport).toUpperCase() +
            '-' +
            String(fd.flight) +
            '-WN-NULL'
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

    function findHeaderColumnIndexByText(headerTr, substr) {
        if (!headerTr || !substr) {
            return -1;
        }
        const u = String(substr).toUpperCase();
        const ths = headerTr.querySelectorAll('th');
        for (var i = 0; i < ths.length; i++) {
            if (thTextNorm(ths[i]).toUpperCase().indexOf(u) >= 0) {
                return i;
            }
        }
        return -1;
    }

    function rowTextAtCellIndex(tr, colIdx) {
        if (colIdx < 0) {
            return '';
        }
        const tds = tr.querySelectorAll('td');
        if (colIdx >= tds.length) {
            return '';
        }
        return (tds[colIdx].textContent || '').replace(/\s+/g, ' ').toUpperCase();
    }

    function textContainsAnyIata(uppercasedCellText, iataList) {
        if (!iataList || !iataList.length) {
            return true;
        }
        var t = (uppercasedCellText || '').toUpperCase();
        var j;
        for (j = 0; j < iataList.length; j++) {
            var c = (iataList[j] && String(iataList[j])) || '';
            c = c.replace(/^\s+|\s+$/g, '').toUpperCase();
            if (c && t.indexOf(c) >= 0) {
                return true;
            }
        }
        return false;
    }

    function rowMatchesDownlineFilter(tr, headerTr, opts) {
        if (!tr || !headerTr) {
            return true;
        }
        var o = opts || { downlineMode: 'off', downlineIataList: [] };
        if (o.downlineMode === 'off' || !o.downlineIataList || !o.downlineIataList.length) {
            return true;
        }
        var nextIdx = findHeaderColumnIndexByText(headerTr, 'NEXT');
        var finalIdx = findHeaderColumnIndexByText(headerTr, 'FINAL');
        var tNext = rowTextAtCellIndex(tr, nextIdx);
        var tFin = rowTextAtCellIndex(tr, finalIdx);
        var mNext = textContainsAnyIata(tNext, o.downlineIataList);
        var mFin = textContainsAnyIata(tFin, o.downlineIataList);
        if (o.downlineMode === 'next') {
            return mNext;
        }
        if (o.downlineMode === 'final') {
            return mFin;
        }
        if (o.downlineMode === 'next_or_final') {
            return mNext || mFin;
        }
        return true;
    }

    /**
     * Minutes from midnight, local interpretation. Picks first H:MM or HH:MM
     * (with optional a/p) in the cell. Returns null if none.
     */
    function stripNestedTablesGetText(el) {
        if (!el || !el.cloneNode) {
            return '';
        }
        const c = el.cloneNode(true);
        const nests = c.querySelectorAll('table');
        for (var ni = 0; ni < nests.length; ni++) {
            if (nests[ni] && nests[ni].parentNode) {
                nests[ni].parentNode.removeChild(nests[ni]);
            }
        }
        return (c.textContent || '')
            .replace(/[\r\n\u00a0]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '');
    }

    /**
     * Schedule ETD/ETA: ignore nested tooltips (e.g. swap FLT table) so the
     * first H:MM in the line cell is the one compared to ref ETA.
     */
    function parseTimeToMinutesFromText(raw) {
        if (!raw) {
            return null;
        }
        var s = String(raw);
        var ampm = null;
        if (/\b([ap])\.?m\.?/i.test(s)) {
            var am = s.match(/\b([ap])\.?m\.?/i);
            if (am) {
                ampm = am[1].toLowerCase() === 'p' ? 'p' : 'a';
            }
        }
        var m = s.match(/(\d{1,2})\s*:\s*(\d{2})/);
        if (!m) {
            return null;
        }
        var h = parseInt(m[1], 10);
        var min = parseInt(m[2], 10);
        if (!Number.isFinite(h) || !Number.isFinite(min)) {
            return null;
        }
        if (ampm === 'p' && h < 12) {
            h += 12;
        }
        if (ampm === 'a' && h === 12) {
            h = 0;
        }
        return h * 60 + min;
    }

    function findEtaColumnIndex(headerTr) {
        if (!headerTr) {
            return -1;
        }
        const ths = headerTr.querySelectorAll('th');
        var i;
        for (i = 0; i < ths.length; i++) {
            const u = thTextNorm(ths[i]).toUpperCase();
            if (u.indexOf('ETA') >= 0) {
                return i;
            }
        }
        return -1;
    }

    function findEtdColumnIndex(headerTr) {
        if (!headerTr) {
            return -1;
        }
        const ths = headerTr.querySelectorAll('th');
        var i;
        for (i = 0; i < ths.length; i++) {
            const u = thTextNorm(ths[i]).toUpperCase();
            if (u.indexOf('ETD') >= 0) {
                return i;
            }
        }
        return -1;
    }

    function minutesDeltaClamped(etdMin, refEtaMin) {
        if (etdMin == null || refEtaMin == null) {
            return null;
        }
        var d = etdMin - refEtaMin;
        if (d < -720) {
            d += 24 * 60;
        } else if (d > 720) {
            d -= 24 * 60;
        }
        return d;
    }

    function findRefFlightEtaMinutes(table, headerTr, fltColIdx, refFlt) {
        if (!table || !headerTr || !refFlt) {
            return null;
        }
        const etaIdx = findEtaColumnIndex(headerTr);
        if (etaIdx < 0) {
            return null;
        }
        const trs = table.querySelectorAll('tr');
        var r;
        for (r = 0; r < trs.length; r++) {
            const tr = trs[r];
            if (tr === headerTr || tr.querySelector('th')) {
                continue;
            }
            const cells = tr.querySelectorAll('td');
            if (cells.length <= fltColIdx) {
                continue;
            }
            const fn = parseFltFromCell(cells[fltColIdx]);
            if (fn !== String(refFlt)) {
                continue;
            }
            const tcell = cells[etaIdx];
            if (!tcell) {
                return null;
            }
            return parseTimeToMinutesFromText(
                tcell.getAttribute('title') || stripNestedTablesGetText(tcell)
            );
        }
        return null;
    }

    function rowMatchesTightTimeRule(tr, headerTr, fltColIdx, refEtaMin, o) {
        if (!o || !o.tightByTime) {
            return false;
        }
        if (refEtaMin == null) {
            return false;
        }
        const etdIdx = findEtdColumnIndex(headerTr);
        if (etdIdx < 0) {
            return false;
        }
        const cells = tr.querySelectorAll('td');
        if (cells.length <= fltColIdx) {
            return false;
        }
        if (!parseFltFromCell(cells[fltColIdx])) {
            return false;
        }
        const tcell = cells[etdIdx];
        if (!tcell) {
            return false;
        }
        const etdM = parseTimeToMinutesFromText(
            tcell.getAttribute('title') || stripNestedTablesGetText(tcell)
        );
        if (etdM == null) {
            return false;
        }
        const gap = minutesDeltaClamped(etdM, refEtaMin);
        if (gap == null) {
            return false;
        }
        const cap = o.tightMaxGapMin;
        if (!Number.isFinite(cap) || cap < 0) {
            return false;
        }
        return gap >= 0 && gap <= cap;
    }

    function rowIsIncludedForPax(
        tr,
        headerTr,
        fltColIdx,
        refFltDigits,
        refEtaMin,
        o
    ) {
        if (!tr) {
            return false;
        }
        const o2 = o || {
            downlineMode: 'off',
            downlineIataList: [],
            tightByTime: true,
            tightMaxGapMin: 20,
            tightTimeOrColor: true
        };
        const cells0 = tr.querySelectorAll('td');
        if (cells0.length <= fltColIdx) {
            return false;
        }
        const of = parseFltFromCell(cells0[fltColIdx]);
        if (refFltDigits && of === String(refFltDigits)) {
            return false;
        }
        if (!rowMatchesDownlineFilter(tr, headerTr, o2)) {
            return false;
        }
        const timeOk = rowMatchesTightTimeRule(
            tr,
            headerTr,
            fltColIdx,
            refEtaMin,
            o2
        );
        const colorOk = isLateStyleRow(tr);
        if (!o2.tightByTime) {
            return colorOk;
        }
        if (o2.tightTimeOrColor) {
            return timeOk || colorOk;
        }
        if (refEtaMin == null) {
            return false;
        }
        return timeOk;
    }

    function parseFltFromCell(td) {
        if (!td) {
            return '';
        }
        var clone = td.cloneNode(true);
        var nests = clone.querySelectorAll('table');
        for (var ni = 0; ni < nests.length; ni++) {
            if (nests[ni] && nests[ni].parentNode) {
                nests[ni].parentNode.removeChild(nests[ni]);
            }
        }
        var t = (clone.textContent || '')
            .replace(/[\r\n\u00a0]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '');
        if (!t) {
            return '';
        }
        var m2 = t.match(/(\d{1,4})/);
        return m2 ? m2[1] : '';
    }

    function findRefLegBlockForOutboundTable(outTable) {
        if (!outTable) {
            return null;
        }
        var w = outTable.parentElement;
        for (var depth = 0; w && depth < 20; depth++) {
            if (
                w.querySelector &&
                w.querySelector('h3') &&
                w.contains &&
                w.contains(outTable)
            ) {
                return w;
            }
            w = w.parentElement;
        }
        return null;
    }

    function connectIataFromRefBlock(block) {
        if (!block || !block.querySelectorAll) {
            return '';
        }
        const tds = block.querySelectorAll('td');
        var k;
        for (k = 0; k < tds.length; k++) {
            if (
                (tds[k].textContent || '')
                    .replace(/\s+/g, ' ')
                    .replace(/^\s+|\s+$/g, '')
                    .toUpperCase() === 'CONNECT'
            ) {
                const tr = tds[k].closest('tr');
                if (tr && tr.nextElementSibling) {
                    const t = tr.nextElementSibling.querySelector('td, th');
                    if (t) {
                        const c = (t.textContent || '')
                            .replace(/^\s+|\s+$/g, '');
                        if (/^[A-Z]{3}$/i.test(c)) {
                            return c.toUpperCase();
                        }
                    }
                }
            }
        }
        return '';
    }

    function findSchArrivalTableInBlockForEta(block) {
        if (!block) {
            return null;
        }
        const tables = block.querySelectorAll('table');
        for (var t = 0; t < tables.length; t++) {
            const tbl = tables[t];
            if (isNestedInCell(tbl)) {
                continue;
            }
            const tr0 = tbl.querySelector('tr');
            if (!tr0) {
                continue;
            }
            const h = (tr0.textContent || '')
                .replace(/\s+/g, ' ')
                .toUpperCase();
            if (h.indexOf('SCH') < 0 || h.indexOf('ARR') < 0) {
                continue;
            }
            if (h.indexOf('ETA') < 0) {
                continue;
            }
            return tbl;
        }
        return null;
    }

    function findRefArrivalTableEtaMinutes(block) {
        const tbl = findSchArrivalTableInBlockForEta(block);
        if (!tbl) {
            return null;
        }
        const trs = tbl.querySelectorAll('tr');
        if (trs.length < 2) {
            return null;
        }
        const thCells = trs[0].querySelectorAll('td, th');
        var etaCol = -1;
        for (var j = 0; j < thCells.length; j++) {
            if (thTextNorm(thCells[j]).toUpperCase().indexOf('ETA') >= 0) {
                etaCol = j;
                break;
            }
        }
        if (etaCol < 0) {
            return null;
        }
        const tds1 = trs[1].querySelectorAll('td, th');
        if (!tds1[etaCol]) {
            return null;
        }
        const elEta = tds1[etaCol];
        return parseTimeToMinutesFromText(
            elEta.getAttribute('title') || stripNestedTablesGetText(elEta)
        );
    }

    function collectLateFlightsFromRoot(root, opts) {
        if (!root) {
            return [];
        }
        const scanOpts = normalizeCollectOpts(opts);
        var tables;
        if (root.nodeName === 'TABLE') {
            if (!isNestedInCell(root) && isOutboundPaxTable(root)) {
                tables = [root];
            } else {
                tables = [];
            }
        } else if (root.querySelectorAll) {
            tables = root.querySelectorAll('table');
        } else {
            return [];
        }
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
            const refFlt = scanOpts.refFlt || null;
            const block = findRefLegBlockForOutboundTable(table);
            var refEta = null;
            if (refFlt) {
                if (block) {
                    const fromArr = findRefArrivalTableEtaMinutes(block);
                    if (fromArr != null) {
                        refEta = fromArr;
                    }
                }
                if (refEta == null) {
                    refEta = findRefFlightEtaMinutes(
                        table,
                        headerTr,
                        idx,
                        refFlt
                    );
                }
            }
            const trs = table.querySelectorAll('tr');
            for (var r = 0; r < trs.length; r++) {
                const tr = trs[r];
                if (tr === headerTr || tr.querySelector('th')) {
                    continue;
                }
                if (
                    !rowIsIncludedForPax(
                        tr,
                        headerTr,
                        idx,
                        refFlt,
                        refEta,
                        scanOpts
                    )
                ) {
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

    function collectLateFlightsFromPageForRoot(rootDocument, paxPathKey, collectOpts) {
        const base = rootDocument || document;
        if (paxPathKey) {
            var wk0 = paxPathKeyFromWindowLocation(base);
            if (wk0 !== paxPathKey) {
                return [];
            }
        }
        const co = normalizeCollectOpts(collectOpts);
        if (paxPathKey && !co.refFlt) {
            const rf = refFlightDigitsFromPaxPathKey(paxPathKey);
            if (rf) {
                co.refFlt = rf;
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
        mergePart(collectLateFlightsFromRoot(base, co));
        const ifrDocs = iframeDocumentListFrom(base);
        var d;
        for (d = 0; d < ifrDocs.length; d++) {
            mergePart(collectLateFlightsFromRoot(ifrDocs[d], co));
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
            const cOpts = normalizeCollectOpts(d.collectOpts || null);
            if (rKey && !cOpts.refFlt) {
                const rfd = refFlightDigitsFromPaxPathKey(rKey);
                if (rfd) {
                    cOpts.refFlt = rfd;
                }
            }
            tryClickPaxOutboundTab(
                function () {
                    const list = collectLateFlightsFromPageForRoot(
                        document,
                        rKey,
                        cOpts
                    );
                    try {
                        if (bcastChannel) {
                            bcastChannel.postMessage({
                                t: 'r',
                                id: reqId,
                                flights: list,
                                paxPathKey: rKey,
                                collectOpts: cOpts
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
            if (st.collectOpts && d.collectOpts) {
                if (collectOptsKey(st.collectOpts) !== collectOptsKey(d.collectOpts)) {
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

    function requestLateFlightsFromOtherWindows(
        localList,
        paxPathKey,
        collectOpts,
        onDone
    ) {
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
        const cOpts = normalizeCollectOpts(collectOpts);
        const st = {
            list: [],
            paxPathKey: paxPathKey || null,
            collectOpts: cOpts
        };
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
        var payload = { t: 'q', id: id, collectOpts: cOpts };
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

    function getWorksheetListWaitMs() {
        const n = Number(getPref('paxLateToWsListWorksheetsMs', 500));
        if (!Number.isFinite(n)) {
            return 500;
        }
        return Math.min(2000, Math.max(200, Math.floor(n)));
    }

    function getWorksheetPageTitle() {
        var t;
        try {
            t = document.title || '';
        } catch (e) {
            t = '';
        }
        t = String(t).replace(/^\s+|\s+$/g, '');
        if (!t) {
            t = 'Worksheet (untitled tab)';
        }
        if (t.length > 200) {
            t = t.slice(0, 200) + '…';
        }
        return t;
    }

    function getOrCreateWorksheetTabId() {
        if (worksheetTabId) {
            return worksheetTabId;
        }
        try {
            const ex = sessionStorage.getItem(WS_TAB_ID_KEY);
            if (ex) {
                worksheetTabId = ex;
                return ex;
            }
        } catch (e) {}
        worksheetTabId =
            'ws' +
            String(Date.now()) +
            '-' +
            String(Math.random()).slice(2, 10);
        try {
            sessionStorage.setItem(WS_TAB_ID_KEY, worksheetTabId);
        } catch (e) {}
        return worksheetTabId;
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

    function ensureWorksheetRegistration() {
        if (!findWorksheetFlightSearchInput() || !wsChannel) {
            return;
        }
        getOrCreateWorksheetTabId();
        var announce = function () {
            if (!wsChannel || !findWorksheetFlightSearchInput()) {
                return;
            }
            try {
                wsChannel.postMessage({
                    t: 'ws_hello',
                    tabId: getOrCreateWorksheetTabId(),
                    title: getWorksheetPageTitle()
                });
            } catch (e) {}
        };
        announce();
        if (!wsTitleObserver && document.querySelector('title')) {
            try {
                wsTitleObserver = new MutationObserver(announce);
                wsTitleObserver.observe(
                    document.querySelector('title'),
                    {
                        childList: true,
                        subtree: true,
                        characterData: true
                    }
                );
            } catch (e) {
                wsTitleObserver = null;
            }
        }
    }

    function listWorksheetTabs() {
        return new Promise(function (resolve) {
            const ch = ensureWsChannel();
            if (!ch) {
                resolve([]);
                return;
            }
            const listId = randomBcastId();
            const seen = Object.create(null);
            var did = false;
            const finish = function () {
                if (did) {
                    return;
                }
                did = true;
                try {
                    ch.removeEventListener('message', onListMsg);
                } catch (e) {}
                try {
                    clearTimeout(to);
                } catch (e) {}
                const out = [];
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
            };
            function onListMsg(ev) {
                const d = ev && ev.data;
                if (!d) {
                    return;
                }
                if (d.t === 'ws_hello' && d.listId === listId && d.tabId) {
                    seen[d.tabId] = { tabId: d.tabId, title: d.title || d.tabId };
                }
            }
            ch.addEventListener('message', onListMsg);
            const to = setTimeout(finish, getWorksheetListWaitMs());
            try {
                ch.postMessage({ t: 'ws_list', listId: listId });
            } catch (e) {
                finish();
                return;
            }
        });
    }

    function showWorksheetPickerDialog(flights, tabs) {
        return new Promise(function (resolve) {
            if (!document.body) {
                resolve(null);
                return;
            }
            if (worksheetPickerOverlay) {
                try {
                    if (worksheetPickerOverlay.parentNode) {
                        worksheetPickerOverlay.parentNode.removeChild(
                            worksheetPickerOverlay
                        );
                    }
                } catch (e) {}
                worksheetPickerOverlay = null;
            }
            const o = document.createElement('div');
            o.setAttribute('data-dc-pax-late-picker', '1');
            o.style.cssText =
                'position:fixed!important;inset:0!important;z-index:1000000!important;background:rgba(0,0,0,.45)!important;display:flex!important;align-items:center!important;justify-content:center!important;';
            const p = document.createElement('div');
            p.style.cssText =
                'background:#1e1e1e!important;color:#eee!important;padding:18px 20px!important;max-width:min(92vw,440px)!important;border-radius:8px!important;box-shadow:0 4px 24px rgba(0,0,0,.45)!important;font:14px/1.35 system-ui,Segoe UI,sans-serif!important;';
            const h = document.createElement('div');
            h.textContent = 'Send ' + flights.length + ' flight(s) to which worksheet?';
            h.style.cssText = 'margin-bottom:10px!important;font-weight:600!important;';
            p.appendChild(h);
            const sc = document.createElement('div');
            sc.style.cssText =
                'max-height:min(50vh,320px)!important;overflow-y:auto!important;';
            for (var i = 0; i < tabs.length; i++) {
                (function (tab) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.textContent = tab.title;
                    b.style.cssText =
                        'display:block!important;width:100%!important;text-align:left!important;padding:8px 10px!important;margin:4px 0!important;border:1px solid #4a4a4a!important;border-radius:4px!important;background:#2a2a2a!important;color:#eee!important;cursor:pointer!important;font:inherit!important;';
                    b.addEventListener('click', function () {
                        cleanup();
                        resolve(tab.tabId);
                    });
                    sc.appendChild(b);
                })(tabs[i]);
            }
            p.appendChild(sc);
            const row = document.createElement('div');
            row.style.cssText =
                'margin-top:12px!important;display:flex!important;gap:8px!important;justify-content:flex-end!important;';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.textContent = 'Cancel';
            function cleanup() {
                if (o.parentNode) {
                    try {
                        o.parentNode.removeChild(o);
                    } catch (e) {}
                }
                worksheetPickerOverlay = null;
            }
            function cancelAll() {
                cleanup();
                resolve(null);
            }
            cancel.addEventListener('click', cancelAll);
            o.addEventListener('click', function (ev) {
                if (ev.target === o) {
                    cancelAll();
                }
            });
            row.appendChild(cancel);
            p.appendChild(row);
            o.appendChild(p);
            worksheetPickerOverlay = o;
            try {
                document.body.appendChild(o);
            } catch (e) {
                resolve(null);
            }
        });
    }

    function ensureWsChannel() {
        if (wsChannel) {
            return wsChannel;
        }
        if (typeof BroadcastChannel === 'undefined') {
            return null;
        }
        try {
            wsChannel = new BroadcastChannel(BC_WS_NAME);
            wsChannel.addEventListener('message', onWsBcast);
        } catch (e) {
            wsChannel = null;
        }
        if (wsChannel && findWorksheetFlightSearchInput()) {
            ensureWorksheetRegistration();
        }
        return wsChannel;
    }

    function onWsBcast(ev) {
        const d = ev && ev.data;
        if (!d || !wsChannel) {
            return;
        }
        if (d.t === 'ws_list' && d.listId) {
            if (!findWorksheetFlightSearchInput()) {
                return;
            }
            try {
                wsChannel.postMessage({
                    t: 'ws_hello',
                    listId: d.listId,
                    tabId: getOrCreateWorksheetTabId(),
                    title: getWorksheetPageTitle()
                });
            } catch (e) {}
            return;
        }
        if (d.t === 'ws_hello' && d.tabId && d.title) {
            return;
        }
        if (d.t === 'ws_apply' && d.id) {
            if (!d.flights || !d.flights.length) {
                return;
            }
            if (!d.targetTabId) {
                return;
            }
            if (d.targetTabId !== getOrCreateWorksheetTabId()) {
                return;
            }
            if (!findWorksheetFlightSearchInput()) {
                return;
            }
            try {
                applyFlightsToWorksheetInThisTab(
                    d.flights,
                    'worksheet: ' + getWorksheetPageTitle()
                );
            } catch (e) {}
        }
    }

    function getDefaultWorksheetForConnectionIata(iata) {
        if (!iata) {
            return null;
        }
        try {
            return localStorage.getItem(LS_WS_BY_CONN + ':' + iata) || null;
        } catch (e) {
            return null;
        }
    }

    function setDefaultWorksheetForConnectionIata(iata, tabId) {
        if (!iata || !tabId) {
            return;
        }
        try {
            localStorage.setItem(LS_WS_BY_CONN + ':' + iata, tabId);
        } catch (e) {}
    }

    function postApplyToWorksheetTab(ch, flights, targetTabId) {
        if (!ch || !targetTabId) {
            return;
        }
        try {
            ch.postMessage({
                t: 'ws_apply',
                id: randomBcastId(),
                flights: flights,
                targetTabId: targetTabId
            });
        } catch (e) {}
    }

    function requestApplyFlightsToWorksheet(flights, applyOpts) {
        if (!flights || !flights.length) {
            return;
        }
        var opt = applyOpts || {};
        if (findWorksheetFlightSearchInput()) {
            applyFlightsToWorksheetInThisTab(flights, 'this tab');
            return;
        }
        const ch = ensureWsChannel();
        if (!ch) {
            log('No BroadcastChannel; cannot target a worksheet tab.');
            return;
        }
        const pickerOn = getPref('paxLateToWsWorksheetPicker', true) !== false;
        var preferred = opt.preferredTabId || null;
        const connI = opt.connectionIata
            ? String(opt.connectionIata).toUpperCase()
            : '';
        const remember = opt.setDefaultForIata && connI;

        function maybeRemember(tabId) {
            if (remember && tabId) {
                setDefaultWorksheetForConnectionIata(connI, tabId);
            }
        }

        listWorksheetTabs().then(function (tabs) {
            var byId = Object.create(null);
            for (var z = 0; z < tabs.length; z++) {
                byId[tabs[z].tabId] = tabs[z];
            }
            if (preferred && byId[preferred]) {
                postApplyToWorksheetTab(ch, flights, preferred);
                return;
            }
            const defI = connI
                ? getDefaultWorksheetForConnectionIata(connI)
                : null;
            if (defI && byId[defI]) {
                postApplyToWorksheetTab(ch, flights, defI);
                return;
            }
            if (tabs.length === 0) {
                log('No worksheet tab (flight field + this script).');
                return;
            }
            if (tabs.length === 1) {
                postApplyToWorksheetTab(ch, flights, tabs[0].tabId);
                maybeRemember(tabs[0].tabId);
                return;
            }
            if (!pickerOn) {
                log(
                    'Multiple worksheets: enable the picker in prefs, set a default for this city, or close extra tabs.'
                );
                return;
            }
            showWorksheetPickerDialog(flights, tabs).then(function (id) {
                if (!id) {
                    return;
                }
                postApplyToWorksheetTab(ch, flights, id);
                if (remember) {
                    setDefaultWorksheetForConnectionIata(connI, id);
                }
            });
        });
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

    function applyFlightsToWorksheetInThisTab(flights, fromTag) {
        if (!flights || !flights.length) {
            if (fromTag) {
                log('No flights to apply (' + fromTag + ').');
            }
            return;
        }
        const delay = stepMs();
        var i = 0;
        if (fromTag) {
            log('Applying to worksheet ("' + fromTag + '")…');
        }
        function runOne() {
            const input = findWorksheetFlightSearchInput();
            if (!input) {
                log('Worksheet flight field not found in this tab.');
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

    function stepThroughFlights(flights) {
        if (!flights || !flights.length) {
            log('No late flights: open the outbound table or check time/ETA columns.');
            return;
        }
        if (findWorksheetFlightSearchInput()) {
            applyFlightsToWorksheetInThisTab(flights, 'alt+click local');
        } else {
            requestApplyFlightsToWorksheet(flights);
        }
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
        const clickFd = findFlightDataFromPuck(puck, e.target);
        var wantMatch = getPref('paxLateToWsMatchPaxPath', true);
        var paxPathKey = null;
        if (wantMatch) {
            if (!clickFd) {
                log('Could not read dep/flight for the clicked leg (puck). Turn off "Match clicked leg" in script prefs or use a different puck area.');
                setTimeout(function () {
                    stepThroughFlights([]);
                }, 0);
                return;
            }
            paxPathKey = buildPaxPathKeyFromFlightData(clickFd);
            if (!paxPathKey) {
                log('Could not build Pax window key (need yyyymmdd, dep, flight on puck).');
                setTimeout(function () {
                    stepThroughFlights([]);
                }, 0);
                return;
            }
            log('Clicked leg key ' + paxPathKey + ' (only this Pax page window is used).');
        }
        var cOpts = normalizeCollectOpts(null);
        if (paxPathKey) {
            const rfd = refFlightDigitsFromPaxPathKey(paxPathKey);
            if (rfd) {
                cOpts.refFlt = rfd;
            }
        }

        function runPaxToWorksheetCollection() {
            tryClickPaxOutboundTab(
                function () {
                    const local = collectLateFlightsFromPageForRoot(
                        document,
                        paxPathKey,
                        cOpts
                    );
                    log(
                        'Local late flights: ' +
                        (local.length ? local.join(', ') : '(none)')
                    );
                    requestLateFlightsFromOtherWindows(
                        local,
                        paxPathKey,
                        cOpts,
                        function (flights) {
                            log(
                                'Merged late flights: ' +
                                (flights.length
                                    ? flights.join(', ')
                                    : '(none)')
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

        if (getPref('paxLateToWsOpenPaxWindow', true) && clickFd) {
            const paxUrl = buildPaxUrlForFlightData(clickFd);
            if (paxUrl) {
                try {
                    log('Opening Pax window: ' + paxUrl);
                    const w = openPaxInSeparateWindow(paxUrl);
                    if (!w) {
                        log('Pax window blocked or failed to open; allow popups for this site.');
                    }
                } catch (e2) {}
            }
        }

        if (getPref('paxLateToWsOpenPaxWindow', true) && clickFd && paxPathKey) {
            var tOpen = setTimeout(
                function () {
                    runPaxToWorksheetCollection();
                },
                afterOpenPaxWaitMs()
            );
            pendingTimeouts.push(tOpen);
        } else {
            runPaxToWorksheetCollection();
        }
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

    function removePaxInlineControls() {
        if (paxBlockMo) {
            try {
                paxBlockMo.disconnect();
            } catch (e) {}
            paxBlockMo = null;
        }
        try {
            document
                .querySelectorAll('tr[data-dc-pax-late-inline]')
                .forEach(function (n) {
                    if (n.parentNode) {
                        n.parentNode.removeChild(n);
                    }
                });
        } catch (e) {}
        try {
            document
                .querySelectorAll('[data-dc-pax-late-inline]')
                .forEach(function (b) {
                    b.removeAttribute('data-dc-pax-late-inline');
                });
        } catch (e) {}
    }

    function mountPaxInlineSendByBlock() {
        if (!isLikelyPaxConnectionsPage()) {
            return;
        }
        if (getPref('paxLateToWsPaxInlineSend', true) === false) {
            removePaxInlineControls();
            return;
        }
        const key = paxPathKeyFromWindowLocation(document);
        if (!key) {
            return;
        }
        const cOpts = normalizeCollectOpts(null);
        const rfd = refFlightDigitsFromPaxPathKey(key);
        if (rfd) {
            cOpts.refFlt = rfd;
        }
        const allTables = document.querySelectorAll('table');
        for (var ti = 0; ti < allTables.length; ti++) {
            const outTable = allTables[ti];
            if (isNestedInCell(outTable) || !isOutboundPaxTable(outTable)) {
                continue;
            }
            const block = findRefLegBlockForOutboundTable(outTable);
            if (!block) {
                continue;
            }
            if (block.getAttribute('data-dc-pax-late-inline') === '1') {
                continue;
            }
            const arrTbl = findSchArrivalTableInBlockForEta(block);
            if (!arrTbl) {
                continue;
            }
            const thRow = arrTbl.querySelector('tr');
            if (!thRow) {
                continue;
            }
            const connectI = connectIataFromRefBlock(block) || 'UNK';
            block.setAttribute('data-dc-pax-late-inline', '1');
            const span = Math.max(
                1,
                thRow.querySelectorAll('td, th').length
            );
            const tr = document.createElement('tr');
            tr.setAttribute('data-dc-pax-late-inline', '1');
            const td = document.createElement('td');
            td.setAttribute('colspan', String(span));
            td.style.cssText =
                'background:#1a1f1a!important;padding:6px 8px!important;border:1px solid #3d5a3a!important;';
            const w = document.createElement('div');
            w.style.cssText =
                'display:flex!important;align-items:center!important;gap:10px!important;flex-wrap:wrap!important;';
            const lab = document.createElement('span');
            lab.textContent = (connectI === 'UNK' ? 'This leg' : connectI) + ' — tight outbounds →';
            lab.style.cssText =
                'color:#b8e0b0!important;font:12px/1.2 system-ui,sans-serif!important;';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Send to worksheet';
            btn.style.cssText =
                'padding:4px 10px!important;border-radius:4px!important;border:1px solid #27ae60!important;' +
                'background:#1e7b34!important;color:#fff!important;font:12px system-ui!important;cursor:pointer!important;';
            btn.setAttribute(
                'title',
                'Send tight outbound FLTs (this block) to a worksheet. First pick saves default for ' +
                    (connectI === 'UNK' ? 'this block' : connectI) +
                    ' (local).'
            );
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                if (!getPref('paxLateToWsEnabled', true)) {
                    return;
                }
                tryClickPaxOutboundTab(
                    function () {
                        const part = collectLateFlightsFromRoot(
                            outTable,
                            cOpts
                        );
                        if (!part || !part.length) {
                            log('No flights in this block.');
                            return;
                        }
                        const saved = getDefaultWorksheetForConnectionIata(
                            connectI
                        );
                        requestApplyFlightsToWorksheet(part, {
                            setDefaultForIata: true,
                            connectionIata: connectI,
                            preferredTabId: saved
                        });
                    },
                    document,
                    key
                );
            });
            w.appendChild(lab);
            w.appendChild(btn);
            td.appendChild(w);
            tr.appendChild(td);
            thRow.insertAdjacentElement('afterend', tr);
        }
    }

    function startPaxInlineObserver() {
        if (!isLikelyPaxConnectionsPage() || paxBlockMo) {
            return;
        }
        mountPaxInlineSendByBlock();
        paxBlockMo = new MutationObserver(function () {
            if (getPref('paxLateToWsPaxInlineSend', true) === false) {
                return;
            }
            mountPaxInlineSendByBlock();
        });
        paxBlockMo.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    function maybeRegisterWorksheetAfterDomChange() {
        if (findWorksheetFlightSearchInput()) {
            ensureWsChannel();
            ensureWorksheetRegistration();
        }
    }

    function init() {
        if (isLikelyPaxConnectionsPage()) {
            ensureWsChannel();
            startPaxInlineObserver();
        } else {
            ensureWsChannel();
            maybeRegisterWorksheetAfterDomChange();
        }
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
            maybeRegisterWorksheetAfterDomChange();
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    initTimer = setTimeout(function () {
        ensureBcastChannel();
        ensureWsChannel();
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
        removePaxInlineControls();
        if (worksheetPickerOverlay) {
            try {
                if (worksheetPickerOverlay.parentNode) {
                    worksheetPickerOverlay.parentNode.removeChild(
                        worksheetPickerOverlay
                    );
                }
            } catch (e) {}
            worksheetPickerOverlay = null;
        }
        if (wsTitleObserver) {
            try {
                wsTitleObserver.disconnect();
            } catch (e) {}
            wsTitleObserver = null;
        }
        if (bcastChannel) {
            try {
                bcastChannel.removeEventListener('message', paxBcastOnMessage);
                bcastChannel.close();
            } catch (e) {}
            bcastChannel = null;
        }
        if (wsChannel) {
            try {
                wsChannel.removeEventListener('message', onWsBcast);
                wsChannel.close();
            } catch (e) {}
            wsChannel = null;
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
