// ==UserScript==
// @name         Highlight Mx station (Icon Logic) Brad's request
// @namespace    Wolf 2.0
// @version      1.5
// @description  Color matches icon unless gray, otherwise default match color
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Highlight%20Mx%20station%20(Icon%20Logic)%20Brad's%20request.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Highlight%20Mx%20station%20(Icon%20Logic)%20Brad's%20request.user.js
// ==/UserScript==

(function () {
    'use strict';

    const WORD_LIST = [
        "ATL","MDW","BWI","OAK","TPA","MCO","DAL","MKE","LAS","PHX","DEN","LAX","SAN","FLL","HOU"
    ];

    const DEFAULT_MATCH_COLOR = "green"; // ← CHANGE THIS ANYTIME
    const SKIP_HEX = "#95a5a6";

    const textSelector = 'div[class="_4bpfoTWyIfY="]';
    const iconSelector = 'div[data-qe-id="workOrder-status"] i';

    function isMatch(text) {
        return WORD_LIST.includes(text.toUpperCase());
    }

    // Convert rgb/rgba to hex for comparison
    function rgbToHex(rgb) {
        const m = rgb.match(/\d+/g);
        if (!m) return null;
        return "#" + m.slice(0,3)
            .map(x => (+x).toString(16).padStart(2,'0'))
            .join('');
    }

    function getIconColor(el) {
        const container = el.parentElement;
        if (!container) return null;

        const icon = container.querySelector(iconSelector);
        if (!icon) return null;

        const color = getComputedStyle(icon).color;
        const hex = rgbToHex(color);

        return hex;
    }

    function highlight(el) {
        const text = el.textContent.trim();

        // reset first
        el.style.fontWeight = "";
        el.style.color = "";

        if (!isMatch(text)) return;

        el.style.fontWeight = "bold";

        const iconHex = getIconColor(el);

        if (iconHex && iconHex.toLowerCase() !== SKIP_HEX) {
            el.style.color = iconHex;
        } else {
            el.style.color = DEFAULT_MATCH_COLOR;
        }
    }

    function scan(root) {
        const nodes = root.matches?.(textSelector)
            ? [root]
            : root.querySelectorAll?.(textSelector) || [];

        nodes.forEach(highlight);
    }

    scan(document);

    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => scan(node));

            if (m.type === 'characterData') {
                const parent = m.target.parentElement;
                if (parent && parent.matches(textSelector)) {
                    highlight(parent);
                }
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    window.__myScriptCleanup = function() {
        observer.disconnect();
        document.querySelectorAll(textSelector).forEach(function(el) {
            el.style.fontWeight = '';
            el.style.color = '';
        });
    };
})();
