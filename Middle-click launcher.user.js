// ==UserScript==
// @name         Middle-click launcher
// @namespace    Wolf 2.0
// @version      3.0.3
// @description  Middle-click a flight puck to open Pax connections, Go turn details, and/or a custom URL (prefs)
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"midClickLaunchPax":{"type":"boolean","group":"Middle-click","label":"Open Pax connections","description":"opssuitemain …/pax-connections/{date}-{dep}-{flight}-WN-NULL","default":true},"midClickLaunchGoTurn":{"type":"boolean","group":"Middle-click","label":"Open Go turn details","description":"Short hover-id: React fiber scan, then synthetic menu read.","default":false},"midClickLaunchCustom":{"type":"boolean","group":"Middle-click","label":"Open custom URL","description":"Uses the template below when enabled.","default":false},"midClickDebugLog":{"type":"boolean","group":"Middle-click","label":"Console debug log","description":"Log [MID-CLICK] diagnostic lines (e.g. Go turn slug from React). Off by default.","default":false},"midClickCustomUrlTemplate":{"type":"string","group":"Middle-click","label":"Custom URL template","description":"Placeholders: {date} yyyymmdd, {depAirport} 3-letter, {flight} digits. Example: https://example.com/track?flt={flight}&dep={depAirport}","default":"","placeholder":"https://…"},"midClickMultiLayout":{"type":"select","group":"Middle-click — multiple windows","label":"When several open at once","description":"Position/size for multiple popups. Side by side uses capped width so windows are not full screen.","default":"horizontal","options":[{"value":"same","label":"Same spot (overlap)"},{"value":"horizontal","label":"Side by side"},{"value":"vertical","label":"Top and bottom"},{"value":"cascade","label":"Cascade (offset)"}]},"midClickMultiMaxWidth":{"type":"number","group":"Middle-click — multiple windows","label":"Max width per window (px)","description":"Caps each popup width when several are open (side by side / vertical).","default":780,"min":400,"max":2000,"step":10},"midClickMultiMaxHeight":{"type":"number","group":"Middle-click — multiple windows","label":"Max height per window (px)","description":"Caps each popup height when several are open.","default":720,"min":320,"max":2000,"step":10},"midClickOverlapTopTarget":{"type":"select","group":"Middle-click — multiple windows","label":"Which window is on top (overlap / cascade)","description":"The last opened popup usually stacks on top. Choose which target opens last.","default":"go_turn","options":[{"value":"pax","label":"Pax connections"},{"value":"go_turn","label":"Go turn details"},{"value":"custom","label":"Custom URL"},{"value":"order","label":"Order in Pref (Pax → Go → Custom)"}]}}
// @donkeycode-pref {"midClickMonitor":{"type":"select","group":"Middle-click — screen","label":"Monitor","description":"Primary: popups align from this window’s left edge. Secondary: add this window’s width (typical side‑by‑side monitors). Extra offsets below are added on top.","default":1,"options":[{"value":1,"label":"Primary"},{"value":2,"label":"Secondary"}]},"midClickMonitorExtraOffsetX":{"type":"number","group":"Middle-click — screen","label":"Extra offset X (px)","description":"Fine-tune horizontal position after monitor choice. 0 = none.","default":0,"min":-8000,"max":8000,"step":1},"midClickMonitorExtraOffsetY":{"type":"number","group":"Middle-click — screen","label":"Extra offset Y (px)","description":"Fine-tune vertical position after monitor choice.","default":0,"min":-8000,"max":8000,"step":1},"midClickWindowMode":{"type":"select","group":"Middle-click — screen","label":"Window mode","description":"New: each target gets its own window. Reuse: one named window — multiple targets replace it in order (only the last URL stays visible).","default":"new","options":[{"value":"new","label":"New window per target"},{"value":"reuse","label":"Reuse one window (same tab)"}]}}
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
    const REUSE_WINDOW_NAME = 'donkeycode_midclick_reuse';

    const puckHandlers = new WeakMap();
    const boundPucks = new Set();
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
        if (!getPref('midClickDebugLog', false)) {
            return;
        }
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

    /**
     * The hover id may be on a child of the leg puck (what you actually click), not on the
     * puck itself — so walk from the *click target* up; then any descendant of the puck; then
     * from the puck up (shared ancestors).
     */
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

    /**
     * Short internal keys (e.g. 2026-04-17-335-6) are not the go-turn slug; the real href only
     * appears in the context-menu portal after contextmenu — see probeGoTurnSlugFromContextMenu.
     */
    function hasFullRouteFromLinkedHover(linkedRaw) {
        return parseLinkedHoverRoute(linkedRaw) !== null;
    }

    /**
     * React 18+ stores fiber on DOM nodes (__reactFiber$...). Props often contain href/to
     * before the context menu exists — works when synthetic contextmenu is ignored (SES / isTrusted).
     */
    function getReactFiberFromNode(node) {
        if (!node || node.nodeType !== 1) {
            return null;
        }
        var k;
        try {
            var names = Object.getOwnPropertyNames(node);
            for (k = 0; k < names.length; k++) {
                var name = names[k];
                if (name.indexOf('__reactFiber') === 0 || name.indexOf('__reactInternalInstance') === 0) {
                    return node[name];
                }
            }
        } catch (e) {}
        return null;
    }

    function tryStringAsGoTurnSlug(s) {
        if (!s || typeof s !== 'string') {
            return null;
        }
        var t = s.trim();
        if (t.indexOf('go-turn-details') !== -1) {
            return slugFromGoTurnHref(t);
        }
        if (parseGoTurnSlugEnrichment(t)) {
            return t;
        }
        var pl = parseLinkedHoverRoute(t);
        if (pl && pl.slug) {
            return pl.slug;
        }
        return null;
    }

    function scanValueForGoTurnSlug(val, depth) {
        if (depth > 8) {
            return null;
        }
        if (val == null) {
            return null;
        }
        if (typeof val === 'string') {
            var asSlug = tryStringAsGoTurnSlug(val);
            if (asSlug) {
                return asSlug;
            }
            if (val.indexOf('go-turn-details') !== -1) {
                return slugFromGoTurnHref(val);
            }
            return null;
        }
        if (typeof val !== 'object') {
            return null;
        }
        if (Array.isArray(val)) {
            var i;
            for (i = 0; i < val.length; i++) {
                var s = scanValueForGoTurnSlug(val[i], depth + 1);
                if (s) {
                    return s;
                }
            }
            return null;
        }
        var key;
        for (key in val) {
            if (!Object.prototype.hasOwnProperty.call(val, key)) {
                continue;
            }
            try {
                var s2 = scanValueForGoTurnSlug(val[key], depth + 1);
                if (s2) {
                    return s2;
                }
            } catch (e) {}
        }
        return null;
    }

    function walkFiberForGoTurnSlug(fiber, seen, depth) {
        if (!fiber || depth > 120 || seen.has(fiber)) {
            return null;
        }
        seen.add(fiber);
        var props = fiber.memoizedProps || fiber.pendingProps;
        if (props) {
            var fromProps = scanValueForGoTurnSlug(props, 0);
            if (fromProps) {
                return fromProps;
            }
        }
        if (fiber.memoizedState !== undefined && fiber.memoizedState !== null) {
            var fromSt = scanValueForGoTurnSlug(fiber.memoizedState, 0);
            if (fromSt) {
                return fromSt;
            }
        }
        var child = fiber.child;
        while (child) {
            var r = walkFiberForGoTurnSlug(child, seen, depth + 1);
            if (r) {
                return r;
            }
            child = child.sibling;
        }
        return null;
    }

    function walkFiberAncestorsForGoTurnSlug(fiber, seen) {
        var cur = fiber;
        var hops = 0;
        while (cur && hops < 24) {
            var r = walkFiberForGoTurnSlug(cur, seen, 0);
            if (r) {
                return r;
            }
            cur = cur.return;
            hops++;
        }
        return null;
    }

    function extractGoTurnSlugFromReactInternals(rootEl) {
        if (!rootEl || !rootEl.querySelectorAll) {
            return null;
        }
        var seen = new WeakSet();
        var nodes = [rootEl].concat(Array.prototype.slice.call(rootEl.querySelectorAll('*')));
        var j;
        for (j = 0; j < nodes.length; j++) {
            var fib = getReactFiberFromNode(nodes[j]);
            if (!fib) {
                continue;
            }
            var slug = walkFiberAncestorsForGoTurnSlug(fib, seen);
            if (slug) {
                return slug;
            }
        }
        return null;
    }

    /**
     * Turn Details in the AC puck menu is often <a class="item"> with no href and
     * value="[object Object]" — route is only in React; scan fiber from that row.
     */
    function findVisibleTurnDetailsMenuItem() {
        var candidates = document.querySelectorAll('a.item, a[class*="item"]');
        var i;
        for (i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!/^turn details$/i.test(t)) {
                continue;
            }
            var r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) {
                continue;
            }
            var st = window.getComputedStyle ? window.getComputedStyle(el) : null;
            if (st && (st.visibility === 'hidden' || st.display === 'none')) {
                continue;
            }
            return el;
        }
        return null;
    }

    function extractGoTurnSlugFromTurnDetailsMenuRow(anchor) {
        if (!anchor) {
            return null;
        }
        var fib = getReactFiberFromNode(anchor);
        if (fib) {
            var seen = new WeakSet();
            var up = walkFiberAncestorsForGoTurnSlug(fib, seen);
            if (up) {
                return up;
            }
        }
        return extractGoTurnSlugFromReactInternals(anchor);
    }

    function readGoTurnSlugFromOpenMenu() {
        function slugFromAnchor(node) {
            if (!node) {
                return null;
            }
            var href = node.getAttribute('href') || node.href || '';
            return slugFromGoTurnHref(href);
        }
        var tdRow = findVisibleTurnDetailsMenuItem();
        if (tdRow) {
            var fromFiber = extractGoTurnSlugFromTurnDetailsMenuRow(tdRow);
            if (fromFiber) {
                return fromFiber;
            }
        }
        var menu = document.querySelector('[data-testid="puck-context-menu"]');
        var a = menu && menu.querySelector('a[href*="go-turn-details"], a[href*="/widgets/go-turn-details"]');
        if (!a && menu && menu.shadowRoot) {
            a = menu.shadowRoot.querySelector('a[href*="go-turn-details"], a[href*="/widgets/go-turn-details"]');
        }
        if (!a) {
            a = document.querySelector('a[href*="go-turn-details"], a[href*="/widgets/go-turn-details"]');
        }
        if (a) {
            return slugFromAnchor(a);
        }
        var links = document.querySelectorAll('a[href*="go-turn-details"], a[href*="/widgets/go-turn-details"]');
        var i;
        for (i = 0; i < links.length; i++) {
            var t = ((links[i].textContent || '') + ' ' + (links[i].getAttribute('aria-label') || '')).replace(/\s+/g, ' ');
            if (/turn\s*details/i.test(t) || /go\s*turn/i.test(t)) {
                return slugFromAnchor(links[i]);
            }
        }
        if (links.length === 1) {
            return slugFromAnchor(links[0]);
        }
        return null;
    }

    function dismissContextMenuProbe() {
        var i;
        for (i = 0; i < 3; i++) {
            try {
                document.body && document.body.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    keyCode: 27,
                    which: 27,
                    bubbles: true,
                    cancelable: true
                }));
                window.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    keyCode: 27,
                    which: 27,
                    bubbles: true,
                    cancelable: true
                }));
            } catch (e) {}
        }
    }

    /**
     * React mounts the menu in a portal after contextmenu — 60ms was too short.
     * Prefer the leg pop-target (schedule handlers often bind there, not the outer puck).
     */
    function probeGoTurnSlugFromContextMenu(puck, cb) {
        if (!puck || typeof puck.getBoundingClientRect !== 'function') {
            cb(null);
            return;
        }

        var targets = [];
        var pop = puck.querySelector('[data-qe-id="as-flight-leg-pop-target"]');
        var depT = puck.querySelector('[data-qe-id="as-flight-leg-dep-station-pop-target"]');
        var arrT = puck.querySelector('[data-qe-id="as-flight-leg-arr-station-pop-target"]');
        if (pop) {
            targets.push(pop);
        }
        if (depT) {
            targets.push(depT);
        }
        if (arrT) {
            targets.push(arrT);
        }
        targets.push(puck);

        function dispatchOn(el) {
            var rect = el.getBoundingClientRect();
            var x = rect.left + Math.max(4, Math.min(rect.width / 2, rect.width - 4));
            var y = rect.top + Math.max(4, Math.min(rect.height / 2, rect.height - 4));
            var common = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 2,
                buttons: 2
            };
            try {
                el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({
                    pointerId: 1,
                    pointerType: 'mouse',
                    isPrimary: true
                }, common)));
            } catch (e1) {}
            try {
                el.dispatchEvent(new MouseEvent('mousedown', common));
            } catch (e2) {
                return false;
            }
            try {
                el.dispatchEvent(new MouseEvent('contextmenu', common));
            } catch (e3) {}
            try {
                el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, common, { buttons: 0 })));
            } catch (e4) {}
            try {
                el.dispatchEvent(new PointerEvent('pointerup', Object.assign({
                    pointerId: 1,
                    pointerType: 'mouse',
                    isPrimary: true,
                    buttons: 0
                }, common)));
            } catch (e5) {}
            return true;
        }

        var targetIdx = 0;
        var mo = null;
        var rafId = null;
        var done = false;

        function finish(slug) {
            if (done) {
                return;
            }
            done = true;
            if (mo) {
                try {
                    mo.disconnect();
                } catch (e) {}
                mo = null;
            }
            if (rafId !== null) {
                try {
                    cancelAnimationFrame(rafId);
                } catch (e) {}
                rafId = null;
            }
            dismissContextMenuProbe();
            window.setTimeout(function() {
                cb(slug || null);
            }, 50);
        }

        function tryNextTarget() {
            if (targetIdx >= targets.length) {
                finish(null);
                return;
            }
            var el = targets[targetIdx++];
            if (!dispatchOn(el)) {
                tryNextTarget();
                return;
            }

            var deadline = Date.now() + 2800;
            mo = new MutationObserver(function() {
                var slug = readGoTurnSlugFromOpenMenu();
                if (slug) {
                    finish(slug);
                }
            });
            try {
                mo.observe(document.documentElement, { childList: true, subtree: true });
            } catch (e) {}

            function poll() {
                if (done) {
                    return;
                }
                var slug = readGoTurnSlugFromOpenMenu();
                if (slug) {
                    finish(slug);
                    return;
                }
                if (Date.now() > deadline) {
                    if (mo) {
                        try {
                            mo.disconnect();
                        } catch (e) {}
                        mo = null;
                    }
                    if (rafId !== null) {
                        try {
                            cancelAnimationFrame(rafId);
                        } catch (e) {}
                        rafId = null;
                    }
                    var late = readGoTurnSlugFromOpenMenu();
                    if (late) {
                        finish(late);
                        return;
                    }
                    window.setTimeout(function() {
                        if (done) {
                            return;
                        }
                        late = readGoTurnSlugFromOpenMenu();
                        if (late) {
                            finish(late);
                            return;
                        }
                        tryNextTarget();
                    }, 320);
                    return;
                }
                rafId = requestAnimationFrame(poll);
            }
            rafId = requestAnimationFrame(poll);
        }

        tryNextTarget();
    }

    function findFlightData(puck, probedGoSlug, clickTarget) {
        var linkedRaw = getLinkedHoverIdForPuck(puck, clickTarget);
        var fromLink = parseLinkedHoverRoute(linkedRaw);

        var domSlug = extractGoTurnSlugFromDom(puck);
        if (fromLink && fromLink.slug && domSlug && domSlug !== fromLink.slug) {
            log('Go turn: ignoring stale in-puck href; using data-linked-hover-id slug');
            domSlug = null;
        }
        var slugForEnrich = probedGoSlug || (fromLink && fromLink.slug) || domSlug;
        var fromDom = slugForEnrich ? parseGoTurnSlugEnrichment(slugForEnrich) : null;

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

        /* probedGoSlug = portal Turn Details; full data-linked-hover-id slug; in-puck link; else rebuild. */
        var goTurnSlug = probedGoSlug ||
            (fromLink && fromLink.slug) ||
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

    function getMonitorOffsets() {
        var mon = Number(getPref('midClickMonitor', 1));
        if (!Number.isFinite(mon) || (mon !== 2 && mon !== 1)) {
            mon = 1;
        }
        var secondaryShift = 0;
        if (mon === 2) {
            secondaryShift = typeof window.outerWidth === 'number' ? window.outerWidth : 0;
        }
        var ox = secondaryShift + Number(getPref('midClickMonitorExtraOffsetX', 0));
        var oy = Number(getPref('midClickMonitorExtraOffsetY', 0));
        if (!isFinite(ox)) {
            ox = secondaryShift;
        }
        if (!isFinite(oy)) {
            oy = 0;
        }
        return { ox: ox, oy: oy };
    }

    function getLayoutRect(index, total, layout) {
        var gap = 8;
        var cap = getMultiWindowSizeCap();
        var mo = getMonitorOffsets();
        var ax = typeof window.screen.availLeft === 'number' ? window.screen.availLeft : 0;
        var ay = typeof window.screen.availTop === 'number' ? window.screen.availTop : 0;
        var aw = typeof window.screen.availWidth === 'number' ? window.screen.availWidth : window.screen.width;
        var ah = typeof window.screen.availHeight === 'number' ? window.screen.availHeight : window.screen.height;
        var out;
        if (total <= 1 || layout === 'same') {
            var pos = getSavedPosition();
            out = {
                left: Math.round(pos.x + mo.ox),
                top: Math.round(pos.y + mo.oy),
                width: WINDOW_WIDTH,
                height: WINDOW_HEIGHT
            };
        } else if (layout === 'cascade') {
            var off = 36;
            var base = getSavedPosition();
            var cw = Math.min(WINDOW_WIDTH, cap.maxW);
            var ch = Math.min(WINDOW_HEIGHT, cap.maxH);
            out = {
                left: Math.round(base.x + index * off + mo.ox),
                top: Math.round(base.y + index * off + mo.oy),
                width: cw,
                height: ch
            };
        } else if (layout === 'vertical') {
            var rows = total;
            var rawH = Math.floor((ah - gap * (rows + 1)) / rows);
            var h = Math.min(Math.max(320, rawH), cap.maxH);
            var rawW = aw - gap * 2;
            var w = Math.min(Math.max(400, rawW), cap.maxW);
            var left = ax + gap + Math.max(0, Math.floor((rawW - w) / 2));
            var totalBlockH = rows * h + gap * (rows - 1);
            var top = ay + gap + Math.max(0, Math.floor((ah - gap * 2 - totalBlockH) / 2)) + index * (h + gap);
            out = { left: left + mo.ox, top: top + mo.oy, width: w, height: h };
        } else {
            /* horizontal (default for multi) */
            var cols = total;
            var rawColW = Math.floor((aw - gap * (cols + 1)) / cols);
            var w2 = Math.min(Math.max(360, rawColW), cap.maxW);
            var rawH2 = ah - gap * 2;
            var h2 = Math.min(Math.max(400, rawH2), cap.maxH);
            var totalRowW = cols * w2 + gap * (cols - 1);
            var left0 = ax + gap + Math.max(0, Math.floor((aw - gap * 2 - totalRowW) / 2));
            var left2 = left0 + index * (w2 + gap);
            var top2 = ay + gap + Math.max(0, Math.floor((ah - gap * 2 - h2) / 2));
            out = { left: left2 + mo.ox, top: top2 + mo.oy, width: w2, height: h2 };
        }
        return out;
    }

    function openWindow(url, index, total, layout) {
        var layoutKey = layout || 'same';
        var r = getLayoutRect(typeof index === 'number' ? index : 0, typeof total === 'number' ? total : 1, layoutKey);
        var mode = String(getPref('midClickWindowMode', 'new') || 'new');
        var targetName = mode === 'reuse' ? REUSE_WINDOW_NAME : '_blank';
        const win = window.open(
            url,
            targetName,
            'width=' + r.width + ',height=' + r.height +
            ',left=' + r.left + ',top=' + r.top +
            ',resizable=yes,scrollbars=yes'
        );
        if (!win) {
            log('Popup blocked');
            return;
        }
        if (mode !== 'reuse') {
            win.name = 'mid_' + Date.now();
        }
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

            var wantGo = !!getPref('midClickLaunchGoTurn', false);
            var linkedRaw = getLinkedHoverIdFromAncestors(puck);
            var needProbe = wantGo && !hasFullRouteFromLinkedHover(linkedRaw);

            function run(data) {
                if (!data) {
                    log('Flight parse failed');
                    return;
                }
                launchAll(data);
            }

            if (needProbe) {
                var fromReact = extractGoTurnSlugFromReactInternals(puck);
                if (fromReact) {
                    log('Go turn: slug from React props (fiber)');
                    run(findFlightData(puck, fromReact, e.target));
                    return;
                }
                probeGoTurnSlugFromContextMenu(puck, function(probedSlug) {
                    if (probedSlug) {
                        log('Go turn: slug from context menu portal');
                    } else if (wantGo) {
                        log('Go turn: context menu probe missed; using fallback slug if any');
                    }
                    run(findFlightData(puck, probedSlug, e.target));
                });
            } else {
                run(findFlightData(puck, null, e.target));
            }
        };

        puckHandlers.set(puck, onMid);
        boundPucks.add(puck);
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
        boundPucks.forEach(function(puck) {
            const h = puckHandlers.get(puck);
            if (h) {
                try {
                    puck.removeEventListener('mousedown', h);
                } catch (e) {}
                puckHandlers.delete(puck);
            }
            try {
                delete puck.dataset.midClickBound;
            } catch (e2) {}
        });
        boundPucks.clear();
        window.__myScriptCleanup = undefined;
    };
})();
