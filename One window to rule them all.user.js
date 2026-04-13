// ==UserScript==
// @name         One window to rule them all
// @namespace    Wolf 2.0
// @version      10.2
// @description  Position popup windows by URL; geometry from DonkeyCODE Pref (Scripts → gear) or defaults below.
// @match        https://opssuitemain.swacorp.com/*
// @run-at       document-start
// @donkeycode-pref {"goTurnMonitor":{"type":"select","label":"Go Turn Details — monitor","description":"Secondary adds the opener window width to horizontal position (use for a second display).","default":1,"options":[{"value":1,"label":"Primary (opener screen)"},{"value":2,"label":"Secondary (opener width offset)"}]},"goTurnLeft":{"type":"number","label":"Go Turn — left offset (px)","default":0,"min":-5000,"max":5000,"step":1},"goTurnTop":{"type":"number","label":"Go Turn — top (px)","default":0,"min":0,"max":4000,"step":1},"goTurnWidth":{"type":"number","label":"Go Turn — width (px)","default":1100,"min":200,"max":4000,"step":1},"goTurnHeight":{"type":"number","label":"Go Turn — height (px)","default":900,"min":200,"max":4000,"step":1}}
// @donkeycode-pref {"relatedFlightsMonitor":{"type":"select","label":"Related flights — monitor","default":1,"options":[{"value":1,"label":"Primary (opener screen)"},{"value":2,"label":"Secondary (opener width offset)"}]},"relatedFlightsLeft":{"type":"number","label":"Related flights — left offset (px)","default":0,"min":-5000,"max":5000,"step":1},"relatedFlightsTop":{"type":"number","label":"Related flights — top (px)","default":0,"min":0,"max":4000,"step":1},"relatedFlightsWidth":{"type":"number","label":"Related flights — width (px)","default":500,"min":200,"max":4000,"step":1},"relatedFlightsHeight":{"type":"number","label":"Related flights — height (px)","default":1800,"min":200,"max":4000,"step":1}}
// @donkeycode-pref {"paxConnectionsMonitor":{"type":"select","label":"Pax connections widget — monitor","default":1,"options":[{"value":1,"label":"Primary (opener screen)"},{"value":2,"label":"Secondary (opener width offset)"}]},"paxConnectionsLeft":{"type":"number","label":"Pax connections — left offset (px)","default":0,"min":-5000,"max":5000,"step":1},"paxConnectionsTop":{"type":"number","label":"Pax connections — top (px)","default":0,"min":0,"max":4000,"step":1},"paxConnectionsWidth":{"type":"number","label":"Pax connections — width (px)","default":1000,"min":200,"max":4000,"step":1},"paxConnectionsHeight":{"type":"number","label":"Pax connections — height (px)","default":800,"min":200,"max":4000,"step":1}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/One%20window%20to%20rule%20them%20all.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/One%20window%20to%20rule%20them%20all.user.js
// ==/UserScript==

(function(donkeycodeGetPref) {
    'use strict';

    const getPref = typeof donkeycodeGetPref === 'function'
        ? donkeycodeGetPref
        : function() { return undefined; };

    function buildRules() {
        const num = function(key, def) {
            const v = getPref(key);
            if (v === undefined || v === null || v === '') return def;
            const x = Number(v);
            return Number.isFinite(x) ? x : def;
        };
        const mon = function(key, def) {
            return num(key, def) === 2 ? 2 : 1;
        };

        return [
            {
                name: 'Go Turn Details',
                match: '/widgets/go-turn-details',
                monitor: mon('goTurnMonitor', 1),
                left: num('goTurnLeft', 0),
                top: num('goTurnTop', 0),
                width: num('goTurnWidth', 1100),
                height: num('goTurnHeight', 900)
            },
            {
                name: 'related-flights',
                match: '/widgets/related-flights',
                monitor: mon('relatedFlightsMonitor', 1),
                left: num('relatedFlightsLeft', 0),
                top: num('relatedFlightsTop', 0),
                width: num('relatedFlightsWidth', 500),
                height: num('relatedFlightsHeight', 1800)
            },
            {
                name: 'pax-connections',
                match: '/widgets/pax-connections',
                monitor: mon('paxConnectionsMonitor', 1),
                left: num('paxConnectionsLeft', 0),
                top: num('paxConnectionsTop', 0),
                width: num('paxConnectionsWidth', 1000),
                height: num('paxConnectionsHeight', 800)
            }
        ];
    }

    const RULES = buildRules();

    const s = document.createElement('script');

    s.textContent = `
        console.log("=== POPUP ROUTER ACTIVE (Reuse + Reload URL) ===");

        const RULES = ${JSON.stringify(RULES)};
        const originalOpen = window.open;

        const windowRefs = {};

        function normalize(url){
            if(!url) return "";
            try { return new URL(url, location.origin).href; }
            catch { return url; }
        }

        function findRule(url){
            const n = normalize(url);
            return RULES.find(r => n.includes(r.match));
        }

        function openWithRule(url, rule){
            const abs = normalize(url);

            //////////////////////////////////////////////////////
            // REUSE EXISTING WINDOW
            //////////////////////////////////////////////////////
            if(windowRefs[rule.name] && !windowRefs[rule.name].closed){
                console.log("Reusing window → Loading new URL:", abs);
                try{
                    windowRefs[rule.name].location.href = abs;
                    windowRefs[rule.name].focus();
                }catch(e){
                    console.error("Failed to update URL:", e);
                }
                return windowRefs[rule.name];
            }

            //////////////////////////////////////////////////////
            // FIRST LAUNCH
            //////////////////////////////////////////////////////
            const baseX = (rule.monitor === 2)
                ? window.screenX + window.outerWidth
                : window.screenX;

            const left = baseX + rule.left;
            const top = rule.top;

            const features =
                \`width=\${rule.width},height=\${rule.height},top=\${top},left=\${left},resizable=yes,scrollbars=yes,toolbar=no,location=no,status=no,menubar=no\`;

            console.group("Opening NEW window");
            console.log("URL:", abs);
            console.log("Rule:", rule.name);

            const w = originalOpen.call(window, abs, "_blank", features);
            windowRefs[rule.name] = w;

            if(w){
                const move = () => {
                    try{
                        w.resizeTo(rule.width, rule.height);
                        w.moveTo(left, top);
                    }catch(e){}
                };
                [200,800,1500,2500].forEach(t => setTimeout(move,t));
            }

            console.groupEnd();
            return w;
        }

        //////////////////////////////////////////////////////
        // OVERRIDE window.open
        //////////////////////////////////////////////////////
        window.open = function(url,name,specs){
            console.log("window.open:", url);
            const rule = findRule(url);
            if(rule){
                return openWithRule(url, rule);
            }
            return originalOpen.call(window,url,name,specs);
        };

        //////////////////////////////////////////////////////
        // INTERCEPT LINKS
        //////////////////////////////////////////////////////
        window.addEventListener("click", e=>{
            const a = e.target.closest("a");
            if(a && a.target === "_blank"){
                const rule = findRule(a.href);
                if(rule){
                    e.preventDefault();
                    openWithRule(a.href, rule);
                }
            }
        }, true);
    `;

    document.documentElement.appendChild(s);
    s.remove();

})(typeof globalThis.donkeycodeGetPref === 'function' ? globalThis.donkeycodeGetPref : undefined);
