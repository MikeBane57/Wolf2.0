// ==UserScript==
// @name         Flight Table Column Controller
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Hide columns and adjust spacing for related flights table
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Flight%20Table%20Column%20Controller.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Flight%20Table%20Column%20Controller.user.js
// ==/UserScript==


(function() {
    'use strict';

    // -------------------------
    // Settings
    // -------------------------
    const columnSettings = {
        'checkbox': { hide: true, width: '0px' },
        'FLT': { hide: false, width: '40px' },
        'LN': { hide: true, width: '30px' },
        'AC': { hide: false, width: '40px' },
        'Dep': { hide: false, width: '30px' },
        'Time Out': { hide: false, width: '30px' },
        'Arr': { hide: false, width: '30px' },
        'Time In': { hide: false, width: '30px' },
        'Turn': { hide: false, width: '30px' },
        'PAX': { hide: false, width: '25px' },
        'LID': { hide: false, width: '25px' }
    };

    function applyColumnControl(table) {
        const headers = table.querySelectorAll('thead th');

        headers.forEach((th, idx) => {
            const label = th.getAttribute('label') || th.textContent.trim();
            const config = columnSettings[label];
            if (!config) return;

            const colIndex = idx + 1; // nth-child is 1-based

            if (config.hide) {
                // Inject CSS to hide entire column
                const style = document.createElement('style');
                style.textContent = `
                    table[data-testid="related-flights-table"]
                    th:nth-child(${colIndex}),
                    table[data-testid="related-flights-table"]
                    td:nth-child(${colIndex}) {
                        display: none !important;
                    }
                `;
                document.head.appendChild(style);
            } else {
                // Apply width normally
                th.style.width = config.width;
                table.querySelectorAll(`tbody tr td:nth-child(${colIndex})`)
                     .forEach(td => td.style.width = config.width);
            }
        });
    }

    function update(root) {
        root.querySelectorAll('table[data-testid="related-flights-table"]')
            .forEach(applyColumnControl);
    }

    // Initial run
    update(document);

    // Watch for dynamic loading
    const observer = new MutationObserver(muts => {
        muts.forEach(m => {
            m.addedNodes.forEach(n => {
                if(n.nodeType === 1) update(n);
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
