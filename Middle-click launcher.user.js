// ==UserScript==
// @name         Middle-click launcher
// @namespace    Wolf 2.0
// @version      2.0
// @description  Middle-click a flight puck to open Pax connections, Go turn details, and/or a custom URL (prefs)
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"midClickLaunchPax":{"type":"boolean","group":"Middle-click","label":"Open Pax connections","description":"opssuitemain …/pax-connections/{date}-{dep}-{flight}-WN-NULL","default":true},"midClickLaunchGoTurn":{"type":"boolean","group":"Middle-click","label":"Open Go turn details","description":"opssuitemain …/go-turn-exec/{date}-{dep}-{flight}-WN-NULL","default":false},"midClickLaunchCustom":{"type":"boolean","group":"Middle-click","label":"Open custom URL","description":"Uses the template below when enabled.","default":false},"midClickCustomUrlTemplate":{"type":"string","group":"Middle-click","label":"Custom URL template","description":"Placeholders: {date} yyyymmdd, {depAirport} 3-letter, {flight} digits. Example: https://example.com/track?flt={flight}&dep={depAirport}","default":"","placeholder":"https://…"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Middle-click%20launcher.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Middle-click%20launcher.user.js
// ==/UserScript==

(function () {
    'use strict';

    const PUCK_SELECTOR =
    '[data-qe-id="as-flight-leg-puck"], [class*="CScizp4RisE="]';

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

    function extractDate(puck) {
        const linked = puck.getAttribute('data-linked-hover-id');
        if (linked) {
            const match = linked.match(/^(\d{4}-\d{2}-\d{2})/);
            if (match) {
                return match[1].replace(/-/g, '');
            }
        }
        return new Date().toISOString().slice(0, 10).replace(/-/g, '');
    }

    function findFlightData(puck) {
        const stationNodes = puck.querySelectorAll('[class*="tg9Iiv9oAOo="]');
        const airports = Array.from(stationNodes)
            .map(n => n.textContent.trim())
            .filter(txt => /^[A-Z]{3}$/.test(txt));
        const depAirport = airports[0] || null;

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
            const linked = puck.getAttribute('data-linked-hover-id');
            const match = linked && linked.match(/^\d{4}-\d{2}-\d{2}-(\d+)-/);
            if (match) {
                flight = match[1];
            }
        }

        if (!/^\d+$/.test(flight)) {
            flight = null;
        }

        const date = extractDate(puck);

        if (!depAirport || !flight) {
            return null;
        }

        return { depAirport, flight, date };
    }

    function buildPaxUrl(data) {
        return 'https://opssuitemain.swacorp.com/pax-connections/' +
            data.date + '-' + data.depAirport + '-' + data.flight + '-WN-NULL';
    }

    function buildGoTurnUrl(data) {
        return 'https://opssuitemain.swacorp.com/go-turn-details/' +
            data.date + '-' + data.depAirport + '-' + data.flight + '-WN-NULL';
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

    function openWindow(url) {
        const pos = getSavedPosition();
        const win = window.open(
            url,
            '_blank',
            'width=' + WINDOW_WIDTH + ',height=' + WINDOW_HEIGHT +
            ',left=' + Math.round(pos.x) + ',top=' + Math.round(pos.y) +
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

    function launchAll(data) {
        var pax = !!getPref('midClickLaunchPax', true);
        var go = !!getPref('midClickLaunchGoTurn', false);
        var cust = !!getPref('midClickLaunchCustom', false);

        if (!pax && !go && !cust) {
            log('No launch targets enabled in Pref');
            return;
        }

        if (pax) {
            openWindow(buildPaxUrl(data));
        }
        if (go) {
            openWindow(buildGoTurnUrl(data));
        }
        if (cust) {
            var u = buildCustomUrl(data);
            if (u) {
                openWindow(u);
            } else {
                log('Custom URL template empty');
            }
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
        document.querySelectorAll(PUCK_SELECTOR).forEach(bindPuck);
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
