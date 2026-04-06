// ==UserScript==
// @name         Date/Time Colors
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Color date/time cells based on day relative to today with 3AM cutover
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// ==/UserScript==


(function() {
    'use strict';

    // Regex to detect date divs like "Feb 13"
    const dateRegex = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/;

    // Today midnight and tomorrow midnight
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const tomorrowMidnight = new Date(todayMidnight.getTime() + 24*60*60*1000);

    // Custom colors
    const yesterdayColor = '#FF8282';
    const todayColor = '#48D1CC';
    const futureColor = '#bb86fa';

    // Parse "Feb 14" into Date object
    function parseDateText(text) {
        const [monthStr, dayStr] = text.split(" ");
        const month = new Date(`${monthStr} 1, 2000`).getMonth();
        const day = parseInt(dayStr, 10);
        const year = new Date().getFullYear();
        return new Date(year, month, day);
    }

    // Parse "HH:MM" into hours and minutes
    function parseHourText(text) {
        const [h, m] = text.split(":").map(Number);
        return { h, m };
    }

    // Compute color based on rules
    function getColorForDateTime(dt) {
        if (dt < todayMidnight) return yesterdayColor;       // yesterday
        if (dt >= todayMidnight && dt < tomorrowMidnight) return todayColor; // today
        return futureColor; // all future days
    }

    function colorTimeline(root) {
        const columns = root.querySelectorAll('div[style*="width: 75px"]');
        let currentDate = null;

        columns.forEach(col => {
            if (col.dataset.tmProcessed) return;

            let dateDiv = null;
            let hourDiv = null;

            col.childNodes.forEach(child => {
                if (child.nodeType !== 1) return; // skip text nodes
                const text = child.textContent.trim();
                if (dateRegex.test(text)) dateDiv = child;
                else if (/^\d{1,2}:\d{2}$/.test(text)) hourDiv = child;
            });

            // Update currentDate if new date div exists
            if (dateDiv) currentDate = parseDateText(dateDiv.textContent.trim());

            if (!currentDate || !hourDiv) return;

            // Combine date + hour
            const {h, m} = parseHourText(hourDiv.textContent.trim());
            const dt = new Date(currentDate);
            dt.setHours(h, m, 0, 0);

            const color = getColorForDateTime(dt);

            // Apply color & bold to date and hour
            if (dateDiv) {
                dateDiv.style.color = color;
                dateDiv.style.fontWeight = 'bold';
            }
            hourDiv.style.color = color;
            hourDiv.style.fontWeight = 'bold';

            col.dataset.tmProcessed = '1';
        });
    }

    // Initial run
    colorTimeline(document);

    // Observe dynamically added content
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if(node.nodeType === 1) colorTimeline(node);
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
