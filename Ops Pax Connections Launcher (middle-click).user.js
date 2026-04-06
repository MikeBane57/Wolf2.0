// ==UserScript==
// @name         Ops Pax Connections Launcher (middle-click)
// @match        https://opssuitemain.swacorp.com/*
// @description  Pax connect middle click.
// @version  1.0
// @grant        none
// ==/UserScript==


(function () {
    'use strict';

    //----------------------------------------------------
    // CONFIG
    //----------------------------------------------------
    const PUCK_SELECTOR =
    '[data-qe-id="as-flight-leg-puck"], [class*="CScizp4RisE="]';

    const WINDOW_WIDTH = 1400;
    const WINDOW_HEIGHT = 900;
    const STORAGE_KEY = "paxConnWindowPos";

    //----------------------------------------------------
    // Logging helper
    //----------------------------------------------------
    function log(...args){
        console.log("%c[PAX-MID]", "color:#00bfff", ...args);
    }

    //----------------------------------------------------
    // Extract date from puck
    //----------------------------------------------------
    function extractDate(puck){
        const linked = puck.getAttribute("data-linked-hover-id");
        if(linked){
            const match = linked.match(/^(\d{4}-\d{2}-\d{2})/);
            if(match){
                return match[1].replace(/-/g,'');
            }
        }

        // fallback to today
        const fallback = new Date().toISOString().slice(0,10).replace(/-/g,'');
        log("Date fallback used:", fallback);
        return fallback;
    }

    //----------------------------------------------------
    // Parse flight data
    //----------------------------------------------------
    function findFlightData(puck){
        // Airports
        const stationNodes = puck.querySelectorAll('[class*="tg9Iiv9oAOo="]');
        const airports = Array.from(stationNodes)
            .map(n => n.textContent.trim())
            .filter(txt => /^[A-Z]{3}$/.test(txt));
        const depAirport = airports[0] || null;

        // Flight number
        let flight = null;
        const flightWrapper = puck.querySelector('[class*="u8OLVYUVzvY="]');
        if(flightWrapper){
            const spanFlight = flightWrapper.querySelector("span");
            if(spanFlight && /^\d{1,4}$/.test(spanFlight.textContent.trim())){
                flight = spanFlight.textContent.trim();
            }
            if(!flight){
                const divFlight = flightWrapper.querySelector('[class*="tw9pR6Lavy8="]');
                if(divFlight && /^\d{1,4}$/.test(divFlight.textContent.trim())){
                    flight = divFlight.textContent.trim();
                }
            }
        }

        // Fallback linked-hover-id
        if(!flight){
            const linked = puck.getAttribute("data-linked-hover-id");
            const match = linked?.match(/^\d{4}-\d{2}-\d{2}-(\d+)-/);
            if(match){
                flight = match[1];
            }
        }

        if(!/^\d+$/.test(flight)) flight = null;
        const date = extractDate(puck);

        if(!depAirport || !flight) return null;

        return { depAirport, flight, date };
    }

    //----------------------------------------------------
    // Build URL
    //----------------------------------------------------
    function buildUrl(data){
        const url =
`https://opssuitemain.swacorp.com/pax-connections/${data.date}-${data.depAirport}-${data.flight}-WN-NULL`;
        log("Generated URL:", url);
        return url;
    }

    //----------------------------------------------------
    // Get saved window position
    //----------------------------------------------------
    function getSavedPosition(){
        const saved = localStorage.getItem(STORAGE_KEY);
        if(!saved){
            return {
                x: window.screenX + (window.outerWidth - WINDOW_WIDTH)/2,
                y: window.screenY + (window.outerHeight - WINDOW_HEIGHT)/2
            };
        }
        return JSON.parse(saved);
    }

    function savePosition(pos){
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    }

    //----------------------------------------------------
    // Open new window in saved position
    //----------------------------------------------------
    function openPaxWindow(url){
        const pos = getSavedPosition();
        const win = window.open(url, "_blank",
            `width=${WINDOW_WIDTH},height=${WINDOW_HEIGHT},left=${Math.round(pos.x)},top=${Math.round(pos.y)},resizable=yes,scrollbars=yes`
        );
        if(!win) {
            log("⚠ Popup blocked");
            return;
        }

        // Periodically ask child window for position
        const winId = 'pax_' + Date.now();
        win.name = winId;

        const interval = setInterval(() => {
            if(win.closed) { clearInterval(interval); return; }
            try { win.postMessage({type:"REQUEST_POSITION"}, "*"); } catch(e){}
        }, 2000);
    }

    //----------------------------------------------------
    // Bind puck for middle-click
    //----------------------------------------------------
    function bindPuck(puck){
        if(puck.dataset.bound) return;
        puck.dataset.bound = "1";

        puck.addEventListener("mousedown", e=>{
            if(e.button !== 1) return; // middle-click only
            e.preventDefault();
            e.stopPropagation();

            log("Middle click detected on puck:", puck);

            const data = findFlightData(puck);
            if(!data){
                log("❌ Flight parse failed");
                return;
            }
            log("Parsed flight data:", data);

            const url = buildUrl(data);
            openPaxWindow(url);
        });
    }

    //----------------------------------------------------
    // Scan existing pucks
    //----------------------------------------------------
    function scan(){
        document.querySelectorAll(PUCK_SELECTOR).forEach(bindPuck);
    }

    //----------------------------------------------------
    // Observe DOM
    //----------------------------------------------------
    const observer = new MutationObserver(mutations=>{
        for(const m of mutations){
            for(const node of m.addedNodes){
                if(node.nodeType !== 1) continue;
                if(node.matches?.(PUCK_SELECTOR)) bindPuck(node);
                node.querySelectorAll?.(PUCK_SELECTOR).forEach(bindPuck);
            }
        }
    });

    //----------------------------------------------------
    // Init
    //----------------------------------------------------
    function init(){
        scan();
        observer.observe(document.body, { childList:true, subtree:true });
    }

    setTimeout(init, 1000);

})();