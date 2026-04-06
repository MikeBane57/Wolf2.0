// ==UserScript==
// @name         Highlight Mx station (Icon Logic) Brad's request
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Color matches icon unless gray, otherwise default match color
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
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

})();