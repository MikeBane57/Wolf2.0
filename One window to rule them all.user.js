// ==UserScript==
// @name         One window to rule them all
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  Position popup windows based on requested URL
// @match        https://opssuitemain.swacorp.com/*
// @run-at       document-start
// ==/UserScript==


(function () {
    'use strict';

    const RULES = [
        {
            name: "Go Turn Details",
            match: "/widgets/go-turn-details",
            monitor: 1,
            left: 0,
            top: 0,
            width: 1100,
            height: 900
        },
        {
            name: "related-flights",
            match: "/widgets/related-flights",
            monitor: 1,
            left: 0,
            top: 0,
            width: 500,
            height: 2800
        },
        {
            name: "pax-connections",
            match: "/widgets/pax-connections",
            monitor: 1,
            left: 0,
            top: 0,
            width: 1000,
            height: 800
        }
    ];

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

})();