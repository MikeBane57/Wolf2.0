// ==UserScript==
// @name         ADSB/flightAware from flight pucks
// @namespace    Wolf 2.0
// @version      1.8
// @description  Double-click dep/arr or flight: airport + flight URLs from prefs (ADSB / FR24 / FlightAware)
// @match        https://opssuitemain.swacorp.com/*
// @donkeycode-pref {"flightTrackerProvider":{"type":"select","group":"Flight tracker (double-click flight number)","label":"Open flight in","description":"Southwest flight number from the puck. Flightradar24: https://www.flightradar24.com/SWA{n} only (no /lat,lon/zoom).","default":"flightaware","options":[{"value":"flightaware","label":"FlightAware"},{"value":"flightradar24","label":"Flightradar24"}]}}
// @donkeycode-pref {"airportMapProvider":{"type":"select","group":"Airport map (double-click dep/arr code)","label":"Open airport in","description":"IATA code from the puck. ADSB Exchange globe or Flightradar24 airport page (e.g. /airport/den).","default":"adsb","options":[{"value":"adsb","label":"ADSB Exchange globe"},{"value":"flightradar24","label":"Flightradar24 airport"}]}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/ADSB-flightAware%20from%20flight%20pucks.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/ADSB-flightAware%20from%20flight%20pucks.user.js
// ==/UserScript==

(function () {
    'use strict';

    function getPref(key, defaultValue) {
        if (typeof donkeycodeGetPref !== 'function') {
            return defaultValue;
        }
        var v = donkeycodeGetPref(key);
        if (v === undefined || v === null || v === '') {
            return defaultValue;
        }
        return v;
    }

    const DOUBLE_MS = 350;
    let lastAction = null;
    let lastTime = 0;

    // ---------- Launchers ----------

    function launchAirport(code) {
        var raw = String(code || '').trim();
        var iata = raw.toUpperCase().replace(/[^A-Z]/g, '');
        if (iata.length !== 3) {
            iata = raw.slice(0, 3).toUpperCase();
        }
        var airportProv = String(getPref('airportMapProvider', 'adsb')).toLowerCase();
        var url;
        if (airportProv === 'flightradar24' || airportProv === 'fr24') {
            url = `https://www.flightradar24.com/airport/${iata.toLowerCase()}`;
        } else {
            url = `https://globe.adsbexchange.com/?airport=${encodeURIComponent(iata)}&zoom=15&labels=1`;
        }

        window.open(
            url,
            "_blank",
            "width=1200,height=800,top=50,left=50,resizable=yes,scrollbars=yes"
        );
    }

    function launchFlightAPI(flightNum) {
        var provider = String(getPref('flightTrackerProvider', 'flightaware')).toLowerCase();
        var url;
        if (provider === 'flightradar24' || provider === 'fr24') {
            // Single-segment flight URL only. FR24’s SPA drops the flight id if we append
            // /lat,lon/zoom (user ends up on e.g. /32.78,-96.80/8 with “no flight info”).
            url = `https://www.flightradar24.com/SWA${flightNum}`;
        } else {
            const callsign = `SWA${flightNum}`;
            url = `https://www.flightaware.com/live/flight/${callsign}`;
        }

        window.open(
            url,
            "_blank",
            "width=1200,height=800,top=100,left=100,resizable=yes,scrollbars=yes"
        );
    }

    // ---------- Target Detection ----------

    function detectClickTarget(x, y) {
        const stack = document.elementsFromPoint(x, y);

        for (const el of stack) {
            const txt = el.textContent?.trim();
            if (!txt) continue;

            if (el.className.includes("u8OLVYUVzvY")) {
                const num = txt.match(/\b\d{1,4}\b/);
                if (num) return { type: "flight", value: num[0] };
            }

            if (el.className.includes("tg9Iiv9oAOo= zbA1EvKL1Bo=")) {
                return { type: "airport-dep", value: txt };
            }

            if (el.className.includes("tg9Iiv9oAOo= Ziu3-r4LY1M=")) {
                return { type: "airport-arr", value: txt };
            }
        }

        return null;
    }

    window.addEventListener('pointerdown', (e) => {
        const hit = detectClickTarget(e.clientX, e.clientY);
        if (!hit) return;

        const now = Date.now();
        const key = `${hit.type}-${hit.value}`;

        if (key === lastAction && (now - lastTime) < DOUBLE_MS) {
            if (hit.type === "airport-dep" || hit.type === "airport-arr") {
                launchAirport(hit.value);
            } else if (hit.type === "flight") {
                launchFlightAPI(hit.value);
            }

            lastAction = null;
            lastTime = 0;
            return;
        }

        lastAction = key;
        lastTime = now;

    }, true);

})();
