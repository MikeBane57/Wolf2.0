
// ==UserScript==
// @name         Spare height
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  shrinks the spare gray bar height
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// ==/UserScript==


(function() {
    'use strict';

    // -------------------------
    // Adjustable settings
    // -------------------------
    const desiredHeight = '12px';   // Height of the element
    const desiredOpacity = 0.3;     // Opacity (0 = transparent, 1 = fully opaque)

    // Function to update height and opacity of matching elements
    function updateElements(root) {
        // Escape the '=' in the class selector
        const elements = root.querySelectorAll('.pfZ-vT1mjJU\\=');
        elements.forEach(el => {
            el.style.height = desiredHeight;
            el.style.opacity = desiredOpacity;
        });
    }

    // Initial run
    updateElements(document);

    // Observe dynamically added content
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if(node.nodeType === 1) updateElements(node);
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
