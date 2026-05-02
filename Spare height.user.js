// ==UserScript==
// @name         Spare height
// @namespace    Wolf 2.0
// @version      1.1
// @description  shrinks the spare gray bar height on spare Aircraft
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Spare%20height.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Spare%20height.user.js
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

    window.__myScriptCleanup = function() {
        observer.disconnect();
        document.querySelectorAll('.pfZ-vT1mjJU\\=').forEach(function(el) {
            el.style.height = '';
            el.style.opacity = '';
        });
    };
})();
