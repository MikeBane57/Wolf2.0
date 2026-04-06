// ==UserScript==
// @name         Turns W&B Launcher (NoDis + Debug)
// @namespace    Wolf 2.0
// @version      3.1
// @description  Reliable dblclick launcher with smart date extraction + logging
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Turns%20W%26B%20Launcher%20(NoDis%20%2B%20Debug).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Turns%20W%26B%20Launcher%20(NoDis%20%2B%20Debug).user.js
// ==/UserScript==

(function () {
    'use strict';

    //----------------------------------------------------
    // CONFIG
    //----------------------------------------------------
    const PUCK_SELECTOR =
    '[data-qe-id="as-flight-leg-puck"], [class*="CScizp4RisE="]';


    const WINDOW_NAME = "turnExecWindow";

    let turnWindow = null;

    //----------------------------------------------------
    // Logging helper
    //----------------------------------------------------
    function log(...args){
     ///////////////   console.log("%c[TURN-LAUNCH]", "color:#00bfff", ...args);
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

        // fallback
        const fallback = new Date()
            .toISOString()
            .slice(0,10)
            .replace(/-/g,'');

     ////////////////   console.log("Date fallback used:", fallback);
        return fallback;
    }

    //----------------------------------------------------
    // Parse flight data
    //----------------------------------------------------
    function findFlightData(puck){

    //----------------------------------------------------
    // Airports
    //----------------------------------------------------
    const stationNodes = puck.querySelectorAll('[class*="tg9Iiv9oAOo="]');

    const airports = Array.from(stationNodes)
        .map(n => n.textContent.trim())
        .filter(txt => /^[A-Z]{3}$/.test(txt));

    const depAirport = airports[0] || null;

        //----------------------------------------------------
        // Flight number (robust across variants)
        //----------------------------------------------------
        let flight = null;

        // flight wrapper
        const flightWrapper = puck.querySelector('[class*="u8OLVYUVzvY="]');

        if(flightWrapper){
            // Try the inner span first
            const spanFlight = flightWrapper.querySelector("span");
            if(spanFlight && /^\d{1,4}$/.test(spanFlight.textContent.trim())){
                flight = spanFlight.textContent.trim();
            }

            // If no span, try the tw9pR6Lavy8 div
            if(!flight){
                const divFlight = flightWrapper.querySelector('[class*="tw9pR6Lavy8="]');
                if(divFlight && /^\d{1,4}$/.test(divFlight.textContent.trim())){
                    flight = divFlight.textContent.trim();
                }
            }
        }

      //////// console.log("Flight detected:", flight);


    //----------------------------------------------------
    // Fallback — linked-hover-id
    //----------------------------------------------------
    if(!flight){
        const linked = puck.getAttribute("data-linked-hover-id");

        const match = linked?.match(/^\d{4}-\d{2}-\d{2}-(\d+)-/);

        if(match){
            flight = match[1];
            source = "linked-hover-id";
        }
    }

    //----------------------------------------------------
    // Validate flight numeric
    //----------------------------------------------------
    if(!/^\d+$/.test(flight)){
        flight = null;
    }

    //----------------------------------------------------
    // Date
    //----------------------------------------------------
    const date = extractDate(puck);

    //----------------------------------------------------
    // Logs
    //----------------------------------------------------
   //////// console.log("Airports detected:", airports);
   //////// console.log("Flight detected:", flight);


    if(!depAirport || !flight){
        return null;
    }

    return {
        depAirport,
        flight,
        date
    };
}


    //----------------------------------------------------
    // Build URL
    //----------------------------------------------------
   function buildUrl(data){

    const url =
`https://opssuitemain.swacorp.com/go-turn-exec/${data.date}-${data.depAirport}-${data.flight}-WN-NULL`;

  ///////////////////  console.log("URL formatted:", url);

    return url;
}


    //----------------------------------------------------
    // Window control
    //----------------------------------------------------
   function openTurnWindow(url){

  ////////////////////  console.log("Attempting window.open with URL:", url);

    const features =
        "popup=yes,width=1400,height=900,resizable=yes,scrollbars=yes";

    try{

        if(turnWindow && !turnWindow.closed){
            turnWindow.location.href = url;
            turnWindow.focus();
     ///////////////////       console.log("Reused existing window");
        } else {
            turnWindow = window.open(url, WINDOW_NAME, features);
   //////////////////        console.log("New window requested");
        }

        if(!turnWindow){
          ////  console.log("⚠ Popup blocked or browser forced tab");
        } else {
     /////////////////       console.log("✅ window.open call completed");
        }

    } catch(err){
  /////////////////////      console.log("❌ window.open error:", err);
    }
}



    //----------------------------------------------------
    // Bind puck
    //----------------------------------------------------
    function bindPuck(puck){

        if(puck.dataset.turnBound) return;
        puck.dataset.turnBound="1";

        puck.addEventListener("dblclick", e=>{
            e.stopPropagation();

      /////////////////////////////////////      console.log("Puck double-click detected:", puck);

            const data = findFlightData(puck);

            if(!data){
              /////  console.log("❌ Flight parse failed");
                return;
            }

      ////////////////////////////////      console.log("Parsed Flight Data:", data);

            const url = buildUrl(data);

     ////////////////////////////////       console.log("Generated URL:", url);

            openTurnWindow(url);
        });
    }

    //----------------------------------------------------
    // Scan
    //----------------------------------------------------
    function scan(){
        document.querySelectorAll(PUCK_SELECTOR)
            .forEach(bindPuck);
    }

    //----------------------------------------------------
    // Observe DOM
    //----------------------------------------------------
    const observer = new MutationObserver(mutations=>{
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

    //----------------------------------------------------
    // Init
    //----------------------------------------------------
    function init(){
        ////////////// console.log("Initializing…");
        scan();

        observer.observe(document.body,{
            childList:true,
            subtree:true
        });
    }

    setTimeout(init,1000);

})();
