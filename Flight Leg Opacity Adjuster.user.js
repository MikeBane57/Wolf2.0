
// ==UserScript==
// @name         Flight Leg Opacity Adjuster
// @namespace    Wolf 2.0
// @version      1.0
// @description  Change opacity of flight leg elements, adjustable in one place
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Flight%20Leg%20Opacity%20Adjuster.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Flight%20Leg%20Opacity%20Adjuster.user.js
// ==/UserScript==


(function() {
    'use strict';

    // -------------------------
    // Adjustable opacity levels
    // -------------------------
    const opacitySettings = {
        '.OV3PKcjpyxw\\=': 0.4,  // Current opacity for .OV3PKcjpyxw= completed flights
        '.vVzbj3J5m70\\=': 0.4   // Current opacity for .vVzbj3J5m70= sched block bar
    };

    // Function to update opacity for each class
    function updateOpacity(root) {
        for (const selector in opacitySettings) {
            const elements = root.querySelectorAll(selector);
            elements.forEach(el => {
                el.style.opacity = opacitySettings[selector];
            });
        }
    }

    // Initial run
    updateOpacity(document);

    // Observe dynamically added content
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if(node.nodeType === 1) updateOpacity(node);
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
