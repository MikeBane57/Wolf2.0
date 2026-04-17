// ==UserScript==
// @name         Middle-click launcher
// @namespace    Wolf 2.0
// @version      2.5
// @description  Middle-click a flight puck to open Pax connections, Go turn details, and/or a custom URL (prefs)
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"midClickLaunchPax":{"type":"boolean","group":"Middle-click","label":"Open Pax connections","description":"opssuitemain …/pax-connections/{date}-{dep}-{flight}-WN-NULL","default":true},"midClickLaunchGoTurn":{"type":"boolean","group":"Middle-click","label":"Open Go turn details","description":"Slug order: data-linked-hover-id on puck/ancestors (canonical leg route) over any in-DOM go-turn link or rebuilt slug. Turn Details href in a portal may not exist at middle-click.","default":false},"midClickLaunchCustom":{"type":"boolean","group":"Middle-click","label":"Open custom URL","description":"Uses the template below when enabled.","default":false},"midClickCustomUrlTemplate":{"type":"string","group":"Middle-click","label":"Custom URL template","description":"Placeholders: {date} yyyymmdd, {depAirport} 3-letter, {flight} digits. Example: https://example.com/track?flt={flight}&dep={depAirport}","default":"","placeholder":"https://…"},"midClickMultiLayout":{"type":"select","group":"Middle-click — multiple windows","label":"When several open at once","description":"Position/size for multiple popups. Side by side uses capped width so windows are not full screen.","default":"horizontal","options":[{"value":"same","label":"Same spot (overlap)"},{"value":"horizontal","label":"Side by side"},{"value":"vertical","label":"Top and bottom"},{"value":"cascade","label":"Cascade (offset)"}]},"midClickMultiMaxWidth":{"type":"number","group":"Middle-click — multiple windows","label":"Max width per window (px)","description":"Caps each popup width when several are open (side by side / vertical).","default":780,"min":400,"max":2000,"step":10},"midClickMultiMaxHeight":{"type":"number","group":"Middle-click — multiple windows","label":"Max height per window (px)","description":"Caps each popup height when several are open.","default":720,"min":320,"max":2000,"step":10},"midClickOverlapTopTarget":{"type":"select","group":"Middle-click — multiple windows","label":"Which window is on top (overlap / cascade)","description":"The last opened popup usually stacks on top. Choose which target opens last.","default":"go_turn","options":[{"value":"pax","label":"Pax connections"},{"value":"go_turn","label":"Go turn details"},{"value":"custom","label":"Custom URL"},{"value":"order","label":"Order in Pref (Pax → Go → Custom)"}]}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Middle-click%20launcher.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Middle-click%20launcher.user.js
// ==/UserScript==

(function () {
    'use strict';

    /** Schedule Virtuoso rows often include puck-context-menu (see Puppeteer replay selectors). */
    const PUCK_SELECTOR = [
        '[data-qe-id="as-flight-leg-puck"]',
        '[data-testid="puck-context-menu"]',
        '[class*="CScizp4RisE="]'
    ].join(', ');

    const WINDOW_WIDTH = 1400;
    const WINDOW_HEIGHT = 900;
    const STORAGE_KEY = 'paxConnWindowPos';

    const puckHandlers = new WeakMap();
    const midIntervals = [];
    let observer = null;
    let initTimer = null;

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

    function log() {
        console.log.apply(console, ['%c[MID-CLICK]', 'color:#00bfff'].concat([].slice.call(arguments)));
    }

    function extractDate(linked) {
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

    /**
     * data-linked-hover-id often encodes the full go-turn slug after the date, e.g.
     * 2026-04-16-1201-MCI-NULL-719-SAT-NULL → 20260416-1201-MCI-NULL-719-SAT-NULL
     * or 20260416-1201-MCI-NULL-719-SAT-NULL
     */
    /**
     * Turn Details often lives in a React portal (body/div[…]), not under the puck — so on
     * middle-click we cannot read that href. Prefer data-linked-hover-id on the puck or an
     * ancestor; optional a[href*=go-turn-details] only under the puck/ancestors (may be absent).
     */
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
                    var slug = slugFromGoTurnHref(nodes[i].getAttribute('href') || nodes[i].href);
                    if (slug) {
                        return slug;
                    }
                }
            }
            cur = cur.parentElement;
            depth++;
        }
        return null;
    }

    /** Slug shape: YYYYMMDD-FLT-DEP-NULL-FLT-ARR-NULL (from go-turn-details path). */
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
        } else if (parts.length >= 9 &&
            /^\d{4}$/.test(parts[0]) && /^\d{2}$/.test(parts[1]) && /^\d{2}$/.test(parts[2])) {
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
        var opFlight = routeParts.length > 3 && /^\d{1,4}$/.test(routeParts[3]) ? routeParts[3] : legFlight;
        var arrAirport = routeParts.length > 4 && /^[A-Z]{3}$/.test(routeParts[4]) ? routeParts[4] : null;

        return {
            dateCompact: dateCompact,
            slug: slug,
            legFlight: legFlight,
            depAirport: depAirport,
            opFlight: opFlight || legFlight,
            arrAirport: arrAirport
        };
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
        return data.date + '-' + leg + '-' + dep + '-NULL-' + op + '-' + arr + '-NULL';
    }

    function findFlightData(puck) {
        var linkedRaw = getLinkedHoverIdFromAncestors(puck);
        var fromLink = parseLinkedHoverRoute(linkedRaw);

        var domSlug = extractGoTurnSlugFromDom(puck);
        if (fromLink && fromLink.slug && domSlug && domSlug !== fromLink.slug) {
            log('Go turn: ignoring stale in-puck href; using data-linked-hover-id slug');
            domSlug = null;
        }
        var fromDom = (fromLink && fromLink.slug)
            ? parseGoTurnSlugEnrichment(fromLink.slug)
            : (domSlug ? parseGoTurnSlugEnrichment(domSlug) : null);

        const stationNodes = puck.querySelectorAll('[class*="tg9Iiv9oAOo="]');
        const airports = Array.from(stationNodes)
            .map(n => n.textContent.trim())
            .filter(txt => /^[A-Z]{3}$/.test(txt));
        var depAirport = airports[0] || (fromLink && fromLink.depAirport) || (fromDom && fromDom.depAirport) || null;
        var arrAirport = airports[1] || (fromLink && fromLink.arrAirport) || (fromDom && fromDom.arrAirport) || null;

        let flight = null;
        const flightWrapper = puck.querySelector('[class*="u8OLVYUVzvY="]');
        if (flightWrapper) {
            const spanFlight = flightWrapper.querySelector('span');
            if (spanFlight && /^\d{1,4}$/.test(spanFlight.textContent.trim())) {
                flight = spanFlight.textContent.trim();
            }
            if (!flight) {
                const divFlight = flightWrapper.querySelector('[class*="tw9pR6Lavy8="]');
                if (divFlight && /^\d{1,4}$/.test(divFlight.textContent.trim())) {
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

        var legFlight = (fromLink && fromLink.legFlight) || (fromDom && fromDom.legFlight) || flight;
        var opFlight = (fromLink && fromLink.opFlight) || (fromDom && fromDom.opFlight) || flight;

        var date = (fromLink && fromLink.dateCompact) || (fromDom && fromDom.dateCompact) || extractDate(linkedRaw);

        /* Canonical route lives in data-linked-hover-id (leg vs marketing differs); prefer it over rebuilt slug. */
        var goTurnSlug = (fromLink && fromLink.slug) ||
            domSlug ||
            buildGoTurnSlugFallback({
                date: date,
                depAirport: depAirport,
                arrAirport: arrAirport,
                flight: flight,
                legFlight: legFlight,
                opFlight: opFlight
            });

        var wantPax = !!getPref('midClickLaunchPax', true);
        var wantGo = !!getPref('midClickLaunchGoTurn', false);
        var wantCust = !!getPref('midClickLaunchCustom', false);

        if (wantPax && (!depAirport || !flight)) {
            return null;
        }
        if (wantGo && !goTurnSlug && !wantPax && !wantCust) {
            return null;
        }

        return {
            depAirport: depAirport || '',
            arrAirport: arrAirport,
            flight: flight || '',
            legFlight: legFlight || flight,
            opFlight: opFlight || flight,
            date: date,
            goTurnSlug: goTurnSlug || ''
        };
    }

    function buildPaxUrl(data) {
        return 'https://opssuitemain.swacorp.com/pax-connections/' +
            data.date + '-' + data.depAirport + '-' + data.flight + '-WN-NULL';
    }

    function buildGoTurnUrl(data) {
        if (!data.goTurnSlug) {
            return '';
        }
        return 'https://opssuitemain.swacorp.com/widgets/go-turn-details/' +
            data.goTurnSlug + '/overview';
    }

    function buildCustomUrl(data) {
        var tpl = String(getPref('midClickCustomUrlTemplate', '') || '').trim();
        if (!tpl) {
            return '';
        }
        return tpl
            .split('{date}').join(encodeURIComponent(data.date))
            .split('{depAirport}').join(encodeURIComponent(data.depAirport))
            .split('{flight}').join(encodeURIComponent(data.flight));
    }

    function getSavedPosition() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) {
                return {
                    x: window.screenX + (window.outerWidth - WINDOW_WIDTH) / 2,
                    y: window.screenY + (window.outerHeight - WINDOW_HEIGHT) / 2
                };
            }
            return JSON.parse(saved);
        } catch (e) {
            return {
                x: window.screenX + (window.outerWidth - WINDOW_WIDTH) / 2,
                y: window.screenY + (window.outerHeight - WINDOW_HEIGHT) / 2
            };
        }
    }

    function getMultiWindowSizeCap() {
        var mw = Number(getPref('midClickMultiMaxWidth', 780));
        var mh = Number(getPref('midClickMultiMaxHeight', 720));
        if (!isFinite(mw) || mw < 400) {
            mw = 780;
        }
        if (!isFinite(mh) || mh < 320) {
            mh = 720;
        }
        return { maxW: mw, maxH: mh };
    }

    function getLayoutRect(index, total, layout) {
        var gap = 8;
        var cap = getMultiWindowSizeCap();
        var ax = typeof window.screen.availLeft === 'number' ? window.screen.availLeft : 0;
        var ay = typeof window.screen.availTop === 'number' ? window.screen.availTop : 0;
        var aw = typeof window.screen.availWidth === 'number' ? window.screen.availWidth : window.screen.width;
        var ah = typeof window.screen.availHeight === 'number' ? window.screen.availHeight : window.screen.height;
        if (total <= 1 || layout === 'same') {
            var pos = getSavedPosition();
            return {
                left: Math.round(pos.x),
                top: Math.round(pos.y),
                width: WINDOW_WIDTH,
                height: WINDOW_HEIGHT
            };
        }
        if (layout === 'cascade') {
            var off = 36;
            var base = getSavedPosition();
            var cw = Math.min(WINDOW_WIDTH, cap.maxW);
            var ch = Math.min(WINDOW_HEIGHT, cap.maxH);
            return {
                left: Math.round(base.x + index * off),
                top: Math.round(base.y + index * off),
                width: cw,
                height: ch
            };
        }
        if (layout === 'vertical') {
            var rows = total;
            var rawH = Math.floor((ah - gap * (rows + 1)) / rows);
            var h = Math.min(Math.max(320, rawH), cap.maxH);
            var rawW = aw - gap * 2;
            var w = Math.min(Math.max(400, rawW), cap.maxW);
            var left = ax + gap + Math.max(0, Math.floor((rawW - w) / 2));
            var totalBlockH = rows * h + gap * (rows - 1);
            var top = ay + gap + Math.max(0, Math.floor((ah - gap * 2 - totalBlockH) / 2)) + index * (h + gap);
            return { left: left, top: top, width: w, height: h };
        }
        /* horizontal (default for multi) */
        var cols = total;
        var rawColW = Math.floor((aw - gap * (cols + 1)) / cols);
        var w = Math.min(Math.max(360, rawColW), cap.maxW);
        var rawH2 = ah - gap * 2;
        var h = Math.min(Math.max(400, rawH2), cap.maxH);
        var totalRowW = cols * w + gap * (cols - 1);
        var left0 = ax + gap + Math.max(0, Math.floor((aw - gap * 2 - totalRowW) / 2));
        var left = left0 + index * (w + gap);
        var top = ay + gap + Math.max(0, Math.floor((ah - gap * 2 - h) / 2));
        return { left: left, top: top, width: w, height: h };
    }

    function openWindow(url, index, total, layout) {
        var layoutKey = layout || 'same';
        var r = getLayoutRect(typeof index === 'number' ? index : 0, typeof total === 'number' ? total : 1, layoutKey);
        const win = window.open(
            url,
            '_blank',
            'width=' + r.width + ',height=' + r.height +
            ',left=' + r.left + ',top=' + r.top +
            ',resizable=yes,scrollbars=yes'
        );
        if (!win) {
            log('Popup blocked');
            return;
        }
        win.name = 'mid_' + Date.now();
        const interval = setInterval(function() {
            if (win.closed) {
                clearInterval(interval);
                return;
            }
            try {
                win.postMessage({ type: 'REQUEST_POSITION' }, '*');
            } catch (e) {}
        }, 2000);
        midIntervals.push(interval);
    }

    function orderLaunchItems(items, topPref) {
        var p = String(topPref || 'go_turn');
        if (p === 'order' || items.length < 2) {
            return items;
        }
        var lastKind = p;
        var lastIdx = -1;
        var i;
        for (i = 0; i < items.length; i++) {
            if (items[i].kind === lastKind) {
                lastIdx = i;
            }
        }
        if (lastIdx <= 0) {
            return items;
        }
        var last = items[lastIdx];
        var out = items.filter(function(_, j) { return j !== lastIdx; });
        out.push(last);
        return out;
    }

    function launchAll(data) {
        var pax = !!getPref('midClickLaunchPax', true);
        var go = !!getPref('midClickLaunchGoTurn', false);
        var cust = !!getPref('midClickLaunchCustom', false);

        if (!pax && !go && !cust) {
            log('No launch targets enabled in Pref');
            return;
        }

        var items = [];
        if (pax) {
            items.push({ kind: 'pax', url: buildPaxUrl(data) });
        }
        if (go) {
            var gUrl = buildGoTurnUrl(data);
            if (!gUrl) {
                log('Go turn URL could not be built (missing route slug)');
            } else {
                items.push({ kind: 'go_turn', url: gUrl });
            }
        }
        if (cust) {
            var u = buildCustomUrl(data);
            if (u) {
                items.push({ kind: 'custom', url: u });
            } else {
                log('Custom URL template empty');
            }
        }

        items = orderLaunchItems(items, getPref('midClickOverlapTopTarget', 'go_turn'));

        var layout = String(getPref('midClickMultiLayout', 'horizontal') || 'horizontal');
        var n = items.length;
        var i;
        for (i = 0; i < items.length; i++) {
            openWindow(items[i].url, i, n, layout);
        }
    }

    function bindPuck(puck) {
        if (puck.dataset.midClickBound) {
            return;
        }
        puck.dataset.midClickBound = '1';

        const onMid = function(e) {
            if (e.button !== 1) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();

            const data = findFlightData(puck);
            if (!data) {
                log('Flight parse failed');
                return;
            }
            launchAll(data);
        };

        puckHandlers.set(puck, onMid);
        puck.addEventListener('mousedown', onMid);
    }

    function scan() {
        document.querySelectorAll(PUCK_SELECTOR).forEach(function(puck) {
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
        observer = new MutationObserver(function(mutations) {
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
        observer.observe(document.body, { childList: true, subtree: true });
    }

    initTimer = setTimeout(init, 1000);

    window.__myScriptCleanup = function() {
        if (initTimer) {
            clearTimeout(initTimer);
            initTimer = null;
        }
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        while (midIntervals.length) {
            try {
                clearInterval(midIntervals.pop());
            } catch (e) {}
        }
        document.querySelectorAll('[data-mid-click-bound]').forEach(function(puck) {
            const h = puckHandlers.get(puck);
            if (h) {
                try {
                    puck.removeEventListener('mousedown', h);
                } catch (e) {}
                puckHandlers.delete(puck);
            }
            delete puck.dataset.midClickBound;
        });
    };
})();
