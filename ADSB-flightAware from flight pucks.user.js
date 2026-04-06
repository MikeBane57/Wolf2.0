// ==UserScript==
// @name         ADSB/flightAware from flight pucks
// @namespace    Wolf 2.0
// @version      1.1.1
// @description  Double-click dep/arr target to open ADSB map for airport
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_openInTab
// @connect      adsbexchange.com
// @updateURL    https://raw.githubusercontent.com/MikeBane57/Wolf2.0/main/ADSB-flightAware%20from%20flight%20pucks.user.js
// @downloadURL  https://raw.githubusercontent.com/MikeBane57/Wolf2.0/main/ADSB-flightAware%20from%20flight%20pucks.user.js
// ==/UserScript==



(function () {
    'use strict';

    const DOUBLE_MS = 350;
    let lastAction = null;
    let lastTime = 0;

    // ---------- Launchers ----------

    function launchAirport(code) {
        const url = `https://globe.adsbexchange.com/?airport=${code}&zoom=15&labels=1`;

        // Open in new window with size 1200x800 at position top=50,left=50
        window.open(
            url,
            "_blank",
            "width=1200,height=800,top=50,left=50,resizable=yes,scrollbars=yes"
        );
    }

    function launchFlightAPI(flightNum) {
        const callsign = `SWA${flightNum}`;
        const url = `https://www.flightaware.com/live/flight/${callsign}`;

        // Open in new window with size 1200x800 at position top=100,left=100
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

            // ✅ FLIGHT NUMBER
            if (el.className.includes("u8OLVYUVzvY")) {
                const num = txt.match(/\b\d{1,4}\b/);
                if (num) return { type: "flight", value: num[0] };
            }

            // ✅ DEPARTURE AIRPORT
            if (el.className.includes("tg9Iiv9oAOo= zbA1EvKL1Bo=")) {
                return { type: "airport-dep", value: txt };
            }

            // ✅ ARRIVAL AIRPORT
            if (el.className.includes("tg9Iiv9oAOo= Ziu3-r4LY1M=")) {
                return { type: "airport-arr", value: txt };
            }
        }

        return null;
    }

    // ---------- Listener ----------

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

