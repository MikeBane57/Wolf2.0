// ==UserScript==
// @name         Turns W&B Launcher (NoDis + Debug)
// @namespace    Wolf 2.0
// @version      3.2
// @description  Reliable dblclick launcher with smart date extraction + logging
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Turns%20W%26B%20Launcher%20(NoDis%20%2B%20Debug).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Turns%20W%26B%20Launcher%20(NoDis%20%2B%20Debug).user.js
// ==/UserScript==

(function () {
    'use strict';

    const PUCK_SELECTOR =
    '[data-qe-id="as-flight-leg-puck"], [class*="CScizp4RisE="]';

    const WINDOW_NAME = "turnExecWindow";

    let turnWindow = null;

    const puckHandlers = new WeakMap();
    let observer = null;
    let initTimer = null;

    function extractDate(puck){

        const linked = puck.getAttribute("data-linked-hover-id");

        if(linked){
            const match = linked.match(/^(\d{4}-\d{2}-\d{2})/);
            if(match){
                return match[1].replace(/-/g,'');
            }
        }

        const fallback = new Date()
            .toISOString()
            .slice(0,10)
            .replace(/-/g,'');

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

    if(!/^\d+$/.test(flight)){
        flight = null;
    }

    const date = extractDate(puck);

    if(!depAirport || !flight){
        return null;
    }

    return {
        depAirport,
        flight,
        date
    };
}


   function buildUrl(data){

    const url =
`https://opssuitemain.swacorp.com/go-turn-exec/${data.date}-${data.depAirport}-${data.flight}-WN-NULL`;

    return url;
}


   function openTurnWindow(url){

    const features =
        "popup=yes,width=1400,height=900,resizable=yes,scrollbars=yes";

    try{

        if(turnWindow && !turnWindow.closed){
            turnWindow.location.href = url;
            turnWindow.focus();
        } else {
            turnWindow = window.open(url, WINDOW_NAME, features);
        }

    } catch(err){
    }
}



    function bindPuck(puck){

        if(puck.dataset.turnBound) return;
        puck.dataset.turnBound="1";

        const onDbl = function(e){
            e.stopPropagation();

            const data = findFlightData(puck);

            if(!data){
                return;
            }

            const url = buildUrl(data);

            openTurnWindow(url);
        };

        puckHandlers.set(puck, onDbl);
        puck.addEventListener("dblclick", onDbl);
    }

    function scan(){
        document.querySelectorAll(PUCK_SELECTOR)
            .forEach(bindPuck);
    }

    function init(){
        scan();

        observer = new MutationObserver(mutations=>{
            for(const m of mutations){
                for(const node of m.addedNodes){

                    if(node.nodeType !== 1) continue;

                    if(node.matches?.(PUCK_SELECTOR)){
                        bindPuck(node);
                    }

                    node.querySelectorAll?.(PUCK_SELECTOR)
                        .forEach(bindPuck);
                }
            }
        });

        observer.observe(document.body,{
            childList:true,
            subtree:true
        });
    }

    initTimer = setTimeout(init,1000);

    window.__myScriptCleanup = function() {
        if (initTimer) {
            clearTimeout(initTimer);
            initTimer = null;
        }
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        document.querySelectorAll('[data-turn-bound]').forEach(function(puck) {
            const h = puckHandlers.get(puck);
            if (h) {
                try { puck.removeEventListener('dblclick', h); } catch (e) {}
                puckHandlers.delete(puck);
            }
            delete puck.dataset.turnBound;
        });
    };

})();
