// ==UserScript==
// @name         Highlight Mx station (Dynamic)
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Bold + yellow highlight for matching words, reacts to dynamic updates
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const WORD_LIST = [
        "ATL","MDW","BWI","OAK","TPA","MCO","DAL","MKE","LAS","PHX","DEN","LAX","SAN","FLL","HOU"
    ];

    const selector = 'div[class="_4bpfoTWyIfY="]';

    function isMatch(text) {
        const lower = text.toLowerCase();
        return WORD_LIST.some(w => w.toLowerCase() === lower);
    }

    function highlight(el) {
        const text = el.textContent.trim();
        if (isMatch(text)) {
            el.style.fontWeight = "bold";
            el.style.color = "yellow";
        } else {
            el.style.fontWeight = "";
            el.style.color = "";
        }
    }

    function scan(root) {
        const nodes = root.matches?.(selector)
            ? [root]
            : root.querySelectorAll?.(selector) || [];
        nodes.forEach(highlight);
        return nodes;
    }

    // Initial scan
    scan(document);

    // Observe new nodes and text changes
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            // New elements added
            m.addedNodes.forEach(node => scan(node));

            // Existing elements updated
            if (m.type === 'characterData') {
                const parent = m.target.parentElement;
                if (parent && parent.matches(selector)) {
                    highlight(parent);
                }
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true, // Watch text changes
    });

})();