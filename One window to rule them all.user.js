// ==UserScript==
// @name         One window to rule them all
// @namespace    Wolf 2.0
// @version      10.5
// @description  Position popup windows by URL; geometry from DonkeyCODE Pref (Scripts → gear) or defaults below.
// @match        https://opssuitemain.swacorp.com/*
// @run-at       document-start
// @donkeycode-pref {"goTurnMonitor":{"type":"select","group":"Go Turn Details","label":"Monitor","description":"Primary: align from opener screen edge. Secondary: add opener window width (typical two-monitor setup).","default":1,"options":[{"value":1,"label":"Primary"},{"value":2,"label":"Secondary"}]},"goTurnLeft":{"type":"number","group":"Go Turn Details","label":"Left (px)","description":"Horizontal offset from the computed edge.","default":0,"min":-5000,"max":5000,"step":1},"goTurnTop":{"type":"number","group":"Go Turn Details","label":"Top (px)","default":0,"min":0,"max":4000,"step":1},"goTurnWidth":{"type":"number","group":"Go Turn Details","label":"Width (px)","default":1100,"min":200,"max":4000,"step":1},"goTurnHeight":{"type":"number","group":"Go Turn Details","label":"Height (px)","default":900,"min":200,"max":4000,"step":1}}
// @donkeycode-pref {"relatedFlightsMonitor":{"type":"select","group":"Related flights","label":"Monitor","description":"Primary: align from opener screen edge. Secondary: add opener window width.","default":1,"options":[{"value":1,"label":"Primary"},{"value":2,"label":"Secondary"}]},"relatedFlightsLeft":{"type":"number","group":"Related flights","label":"Left (px)","description":"Horizontal offset from the computed edge.","default":0,"min":-5000,"max":5000,"step":1},"relatedFlightsTop":{"type":"number","group":"Related flights","label":"Top (px)","default":0,"min":0,"max":4000,"step":1},"relatedFlightsWidth":{"type":"number","group":"Related flights","label":"Width (px)","default":500,"min":200,"max":4000,"step":1},"relatedFlightsHeight":{"type":"number","group":"Related flights","label":"Height (px)","default":1800,"min":200,"max":4000,"step":1}}
// @donkeycode-pref {"paxConnectionsMonitor":{"type":"select","group":"Pax connections (widget)","label":"Monitor","description":"Primary: align from opener screen edge. Secondary: add opener window width.","default":1,"options":[{"value":1,"label":"Primary"},{"value":2,"label":"Secondary"}]},"paxConnectionsLeft":{"type":"number","group":"Pax connections (widget)","label":"Left (px)","description":"Horizontal offset from the computed edge.","default":0,"min":-5000,"max":5000,"step":1},"paxConnectionsTop":{"type":"number","group":"Pax connections (widget)","label":"Top (px)","default":0,"min":0,"max":4000,"step":1},"paxConnectionsWidth":{"type":"number","group":"Pax connections (widget)","label":"Width (px)","default":1000,"min":200,"max":4000,"step":1},"paxConnectionsHeight":{"type":"number","group":"Pax connections (widget)","label":"Height (px)","default":800,"min":200,"max":4000,"step":1}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/One%20window%20to%20rule%20them%20all.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/One%20window%20to%20rule%20them%20all.user.js
// ==/UserScript==

(function() {
    'use strict';

    /**
     * DonkeyCODE injects donkeycodeGetPref as the wrapper function parameter — it is
     * NOT necessarily on globalThis. Do not IIFE (fn)(globalThis.donkeycodeGetPref).
     */
    var getPref = typeof donkeycodeGetPref === 'function'
        ? donkeycodeGetPref
        : function() { return undefined; };

    function buildRules() {
        var num = function(key, def) {
            var v = getPref(key);
            if (v === undefined || v === null || v === '') return def;
            var x = Number(v);
            return Number.isFinite(x) ? x : def;
        };
        var mon = function(key, def) {
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

    var RULES = buildRules();

    var s = document.createElement('script');

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

            // Popup geometry from the features string can be applied late (SPA paint,
            // etc.), which feels like "I moved it and it jumped." We apply prefs once
            // after the child window fires load, in rAF — not on a repeating timer.
            // If the user already moved/resized the popup before then, skip so we
            // do not snap back over their gesture.
            if (w) {
                const leftPx = left;
                const topPx = top;
                const wPx = rule.width;
                const hPx = rule.height;
                let placed = false;
                let lastSample = null;

                const sample = function() {
                    if (!w || w.closed) return;
                    try {
                        const cur = {
                            x: w.screenX,
                            y: w.screenY,
                            ow: w.outerWidth,
                            oh: w.outerHeight
                        };
                        if (lastSample) {
                            const moved = Math.abs(cur.x - lastSample.x) > 6 ||
                                Math.abs(cur.y - lastSample.y) > 6;
                            const resized = Math.abs(cur.ow - lastSample.ow) > 8 ||
                                Math.abs(cur.oh - lastSample.oh) > 8;
                            if (moved || resized) {
                                w.__owtrtaUserAdjusted = true;
                            }
                        }
                        lastSample = cur;
                    } catch (e) {}
                };

                const sampler = setInterval(sample, 120);
                setTimeout(function() {
                    try { clearInterval(sampler); } catch (e) {}
                }, 1400);

                const placeOnce = function() {
                    if (placed || !w || w.closed) return;
                    if (w.__owtrtaUserAdjusted) return;
                    placed = true;
                    try {
                        w.resizeTo(wPx, hPx);
                        w.moveTo(leftPx, topPx);
                    } catch (e) {}
                };

                const schedulePlace = function() {
                    requestAnimationFrame(placeOnce);
                };

                try {
                    if (w.document && w.document.readyState === "complete") {
                        schedulePlace();
                    } else {
                        w.addEventListener("load", schedulePlace, { once: true });
                    }
                } catch (e) {
                    setTimeout(schedulePlace, 0);
                }
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

})();
