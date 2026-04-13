// ==UserScript==
// @name         Ops Pax Connections Launcher (middle-click)
// @namespace Wolf 2.0
// @match        https://opssuitemain.swacorp.com/*
// @description  Launch Pax connect on middle click.
// @version  1.1
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Ops%20Pax%20Connections%20Launcher%20(middle-click).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Ops%20Pax%20Connections%20Launcher%20(middle-click).user.js
// ==/UserScript==


(function () {
    'use strict';

    const PUCK_SELECTOR =
    '[data-qe-id="as-flight-leg-puck"], [class*="CScizp4RisE="]';

    const WINDOW_WIDTH = 1400;
    const WINDOW_HEIGHT = 900;
    const STORAGE_KEY = "paxConnWindowPos";

    const puckHandlers = new WeakMap();
    const paxIntervals = [];
    let observer = null;
    let initTimer = null;

    function log(...args){
        console.log("%c[PAX-MID]", "color:#00bfff", ...args);
    }

    function extractDate(puck){
        const linked = puck.getAttribute("data-linked-hover-id");
        if(linked){
            const match = linked.match(/^(\d{4}-\d{2}-\d{2})/);
            if(match){
                return match[1].replace(/-/g,'');
            }
        }

        const fallback = new Date().toISOString().slice(0,10).replace(/-/g,'');
        log("Date fallback used:", fallback);
        return fallback;
    }

    function findFlightData(puck){
        const stationNodes = puck.querySelectorAll('[class*="tg9Iiv9oAOo="]');
        const airports = Array.from(stationNodes)
            .map(n => n.textContent.trim())
            .filter(txt => /^[A-Z]{3}$/.test(txt));
        const depAirport = airports[0] || null;

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

    function buildUrl(data){
        const url =
`https://opssuitemain.swacorp.com/pax-connections/${data.date}-${data.depAirport}-${data.flight}-WN-NULL`;
        log("Generated URL:", url);
        return url;
    }

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

    function openPaxWindow(url){
        const pos = getSavedPosition();
        const win = window.open(url, "_blank",
            `width=${WINDOW_WIDTH},height=${WINDOW_HEIGHT},left=${Math.round(pos.x)},top=${Math.round(pos.y)},resizable=yes,scrollbars=yes`
        );
        if(!win) {
            log("⚠ Popup blocked");
            return;
        }

        win.name = 'pax_' + Date.now();

        const interval = setInterval(() => {
            if(win.closed) { clearInterval(interval); return; }
            try { win.postMessage({type:"REQUEST_POSITION"}, "*"); } catch(e){}
        }, 2000);
        paxIntervals.push(interval);
    }

    function bindPuck(puck){
        if(puck.dataset.paxMidBound) return;
        puck.dataset.paxMidBound = "1";

        const onMid = function(e){
            if(e.button !== 1) return;
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
        };

        puckHandlers.set(puck, onMid);
        puck.addEventListener("mousedown", onMid);
    }

    function scan(){
        document.querySelectorAll(PUCK_SELECTOR).forEach(bindPuck);
    }

    function init(){
        scan();
        observer = new MutationObserver(mutations=>{
            for(const m of mutations){
                for(const node of m.addedNodes){
                    if(node.nodeType !== 1) continue;
                    if(node.matches?.(PUCK_SELECTOR)) bindPuck(node);
                    node.querySelectorAll?.(PUCK_SELECTOR).forEach(bindPuck);
                }
            }
        });
        observer.observe(document.body, { childList:true, subtree:true });
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
        while (paxIntervals.length) {
            try { clearInterval(paxIntervals.pop()); } catch (e) {}
        }
        document.querySelectorAll('[data-pax-mid-bound]').forEach(function(puck) {
            const h = puckHandlers.get(puck);
            if (h) {
                try { puck.removeEventListener('mousedown', h); } catch (e) {}
                puckHandlers.delete(puck);
            }
            delete puck.dataset.paxMidBound;
        });
    };

})();
