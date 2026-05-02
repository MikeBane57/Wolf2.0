// ==UserScript==
// @name         Highlight OW/ET origin (Dynamic)
// @namespace    Wolf 2.0
// @version      1.2
// @description  Turns line mission type yellow when block contains OW or ET, reacts to dynamic updates
// @match        https://opssuitemain.swacorp.com/*worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Highlight%20OW-ET%20origin%20(Dynamic).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Highlight%20OW-ET%20origin%20(Dynamic).user.js
// ==/UserScript==

(function () {
    'use strict';

    const WORDS = ["OW", "ET"];
    const selector = 'div[class="XrjX-V8q874="] span';

    function isMatch(text) {
        const t = text.trim().toLowerCase();
        return WORDS.some(w => w.toLowerCase() === t);
    }

    function process(el) {
        const text = el.textContent.trim();

        if (isMatch(text)) {
            el.style.color = "yellow";
            el.style.fontWeight = "bold"; // optional
        } else {
            el.style.color = "";
            // el.style.fontWeight = "";
        }
    }

    function scan(root) {
        const nodes = root.matches?.(selector)
            ? [root]
            : root.querySelectorAll?.(selector) || [];

        nodes.forEach(process);
        return nodes;
    }

    // Initial scan
    scan(document);

    // Observe new nodes and text changes
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            // New nodes added
            m.addedNodes.forEach(node => scan(node));

            // Existing text updated
            if (m.type === 'characterData') {
                const parent = m.target.parentElement;
                if (parent && parent.matches(selector)) {
                    process(parent);
                }
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true // watch text changes
    });

    window.__myScriptCleanup = function() {
        observer.disconnect();
        document.querySelectorAll(selector).forEach(function(el) {
            el.style.color = '';
            el.style.fontWeight = '';
        });
    };
})();
