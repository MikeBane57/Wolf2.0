// ==UserScript==
// @name         Timeline transparent box
// @namespace    Wolf 2.0
// @version      0.1.0
// @description  Draw a configurable transparent time-range box on the Ops Suite timeline
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"timelineBoxEnabled":{"type":"boolean","group":"Timeline box","label":"Show timeline box","default":true},"timelineBoxStart":{"type":"string","group":"Timeline box","label":"Start","description":"Accepted examples: May 1 09:00, May 1 2026 09:00, 2026-05-01 09:00, or 09:00 for the first visible timeline date.","default":"","placeholder":"May 1 09:00"},"timelineBoxEnd":{"type":"string","group":"Timeline box","label":"End","description":"Same format as Start. If Start/End are blank, the script highlights the current hour when visible.","default":"","placeholder":"May 1 12:00"},"timelineBoxTop":{"type":"number","group":"Timeline box","label":"Top offset (px)","description":"Vertical offset inside the wide timeline strip.","default":0,"min":-2000,"max":2000,"step":1},"timelineBoxHeight":{"type":"number","group":"Timeline box","label":"Height (px)","default":44,"min":1,"max":2000,"step":1},"timelineBoxFill":{"type":"string","group":"Timeline box","label":"Fill color","description":"CSS color; rgba() keeps the box transparent.","default":"rgba(255, 255, 255, 0.16)","placeholder":"rgba(255, 255, 255, 0.16)"},"timelineBoxBorder":{"type":"string","group":"Timeline box","label":"Border","description":"CSS border value.","default":"2px solid rgba(255, 255, 255, 0.75)","placeholder":"2px solid rgba(255, 255, 255, 0.75)"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Timeline%20transparent%20box.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Timeline%20transparent%20box.user.js
// ==/UserScript==

(function() {
    'use strict';

    var OVERLAY_CLASS = 'dc-timeline-transparent-box';
    var HOST_DATA_ATTR = 'dcTimelineBoxPosition';
    var MONTHS = {
        Jan: 0,
        Feb: 1,
        Mar: 2,
        Apr: 3,
        May: 4,
        Jun: 5,
        Jul: 6,
        Aug: 7,
        Sep: 8,
        Oct: 9,
        Nov: 10,
        Dec: 11
    };

    var observer = null;
    var rafId = 0;

    function getPref(key, defaultValue) {
        if (typeof donkeycodeGetPref !== 'function') {
            return defaultValue;
        }

        var value = donkeycodeGetPref(key);
        if (value === undefined || value === null || value === '') {
            return defaultValue;
        }
        return value;
    }

    function getStringPref(key, defaultValue) {
        return String(getPref(key, defaultValue)).trim();
    }

    function getNumberPref(key, defaultValue) {
        var n = Number(getPref(key, defaultValue));
        return Number.isFinite(n) ? n : defaultValue;
    }

    function isEnabled() {
        return getPref('timelineBoxEnabled', true) !== false;
    }

    function clamp(n, min, max) {
        return Math.min(max, Math.max(min, n));
    }

    function getElementText(el) {
        return (el && el.textContent ? el.textContent : '').trim();
    }

    function getHourTextFromColumn(col) {
        var children = col.children || [];
        for (var i = 0; i < children.length; i++) {
            var text = getElementText(children[i]);
            if (/^\d{1,2}:\d{2}$/.test(text)) {
                return text;
            }
        }
        return '';
    }

    function getDateTextFromColumn(col) {
        var children = col.children || [];
        for (var i = 0; i < children.length; i++) {
            var text = getElementText(children[i]);
            if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/.test(text)) {
                return text;
            }
        }
        return '';
    }

    function parseHourParts(text) {
        var m = /^(\d{1,2}):(\d{2})$/.exec(text);
        if (!m) {
            return null;
        }

        var hour = Number(m[1]);
        var minute = Number(m[2]);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            return null;
        }

        return { hour: hour, minute: minute };
    }

    function parseMonthDay(text) {
        var m = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/.exec(text);
        if (!m) {
            return null;
        }

        var day = Number(m[2]);
        if (day < 1 || day > 31) {
            return null;
        }

        return {
            monthName: m[1],
            month: MONTHS[m[1]],
            day: day
        };
    }

    function makeDate(year, month, day, hour, minute) {
        return new Date(year, month, day, hour, minute, 0, 0);
    }

    function getColumnWidth(col) {
        var rect = col.getBoundingClientRect();
        if (rect.width > 0) {
            return rect.width;
        }

        var styleWidth = parseFloat(col.style.width || '');
        if (Number.isFinite(styleWidth) && styleWidth > 0) {
            return styleWidth;
        }

        return col.offsetWidth || 75;
    }

    function findTimelineContents(root) {
        var found = [];
        var containers = [];

        if (root.nodeType === 1 && root.matches && root.matches('[data-dragscroll]')) {
            containers.push(root);
        }

        if (root.querySelectorAll) {
            var matches = root.querySelectorAll('[data-dragscroll]');
            for (var i = 0; i < matches.length; i++) {
                containers.push(matches[i]);
            }
        }

        for (var j = 0; j < containers.length; j++) {
            var content = containers[j].firstElementChild;
            if (!content) {
                continue;
            }

            var hourColumns = 0;
            var children = content.children || [];
            for (var k = 0; k < children.length; k++) {
                if (getHourTextFromColumn(children[k])) {
                    hourColumns++;
                    if (hourColumns >= 6) {
                        found.push(content);
                        break;
                    }
                }
            }
        }

        return found;
    }

    function buildMarkers(content) {
        var markers = [];
        var currentMonthDay = null;
        var currentYear = new Date().getFullYear();
        var previousDateOnly = null;
        var children = content.children || [];

        for (var i = 0; i < children.length; i++) {
            var col = children[i];
            var dateText = getDateTextFromColumn(col);
            var hourText = getHourTextFromColumn(col);

            if (dateText) {
                currentMonthDay = parseMonthDay(dateText);
                if (currentMonthDay) {
                    var dateOnly = new Date(currentYear, currentMonthDay.month, currentMonthDay.day);

                    if (previousDateOnly && dateOnly.getTime() < previousDateOnly.getTime() - 180 * 24 * 60 * 60 * 1000) {
                        currentYear++;
                        dateOnly = new Date(currentYear, currentMonthDay.month, currentMonthDay.day);
                    }

                    previousDateOnly = dateOnly;
                }
            }

            if (!currentMonthDay || !hourText) {
                continue;
            }

            var hourParts = parseHourParts(hourText);
            if (!hourParts) {
                continue;
            }

            markers.push({
                time: makeDate(currentYear, currentMonthDay.month, currentMonthDay.day, hourParts.hour, hourParts.minute).getTime(),
                month: currentMonthDay.month,
                day: currentMonthDay.day,
                x: col.offsetLeft,
                width: getColumnWidth(col)
            });
        }

        return markers;
    }

    function parseConfiguredTime(text, markers) {
        var trimmed = String(text || '').trim();
        var now = new Date();
        var isoMatch;
        var monthMatch;
        var hourParts;
        var year;
        var month;
        var day;

        if (!trimmed) {
            return null;
        }

        isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(trimmed);
        if (isoMatch) {
            return makeDate(
                Number(isoMatch[1]),
                Number(isoMatch[2]) - 1,
                Number(isoMatch[3]),
                Number(isoMatch[4]),
                Number(isoMatch[5])
            ).getTime();
        }

        monthMatch = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?\s+(\d{1,2}):(\d{2})$/i.exec(trimmed);
        if (monthMatch) {
            month = MONTHS[monthMatch[1].slice(0, 1).toUpperCase() + monthMatch[1].slice(1, 3).toLowerCase()];
            day = Number(monthMatch[2]);
            year = monthMatch[3] ? Number(monthMatch[3]) : findVisibleYear(markers, month, day, now.getFullYear());
            return makeDate(year, month, day, Number(monthMatch[4]), Number(monthMatch[5])).getTime();
        }

        hourParts = parseHourParts(trimmed);
        if (hourParts && markers.length > 0) {
            var first = new Date(markers[0].time);
            return makeDate(first.getFullYear(), first.getMonth(), first.getDate(), hourParts.hour, hourParts.minute).getTime();
        }

        return null;
    }

    function findVisibleYear(markers, month, day, fallbackYear) {
        for (var i = 0; i < markers.length; i++) {
            if (markers[i].month === month && markers[i].day === day) {
                return new Date(markers[i].time).getFullYear();
            }
        }

        return fallbackYear;
    }

    function getDefaultRange(markers) {
        var now = new Date();
        now.setMinutes(0, 0, 0);

        return {
            start: now.getTime(),
            end: now.getTime() + 60 * 60 * 1000
        };
    }

    function getTimeRange(markers) {
        var startText = getStringPref('timelineBoxStart', '');
        var endText = getStringPref('timelineBoxEnd', '');
        var range;
        var start;
        var end;

        if (!startText && !endText) {
            range = getDefaultRange(markers);
            start = range.start;
            end = range.end;
        } else {
            start = parseConfiguredTime(startText, markers);
            end = parseConfiguredTime(endText, markers);
        }

        if (start === null || end === null || end <= start) {
            return null;
        }

        return {
            start: start,
            end: end
        };
    }

    function getPositionForTime(markers, targetTime) {
        var last;
        var lastEnd;

        if (!markers.length) {
            return null;
        }

        for (var i = 0; i < markers.length - 1; i++) {
            var a = markers[i];
            var b = markers[i + 1];

            if (targetTime >= a.time && targetTime <= b.time) {
                var spanTime = b.time - a.time;
                var spanX = b.x - a.x;
                if (spanTime <= 0 || spanX <= 0) {
                    return a.x;
                }
                return a.x + spanX * ((targetTime - a.time) / spanTime);
            }
        }

        last = markers[markers.length - 1];
        lastEnd = last.time + 60 * 60 * 1000;
        if (targetTime >= last.time && targetTime <= lastEnd) {
            return last.x + last.width * ((targetTime - last.time) / (60 * 60 * 1000));
        }

        return null;
    }

    function ensureHostPosition(content) {
        var position = window.getComputedStyle(content).position;
        if (position === 'static') {
            content.dataset[HOST_DATA_ATTR] = 'static';
            content.style.position = 'relative';
        }
    }

    function removeOverlays(root) {
        var overlays = root.querySelectorAll ? root.querySelectorAll('.' + OVERLAY_CLASS) : [];
        for (var i = 0; i < overlays.length; i++) {
            overlays[i].remove();
        }
    }

    function drawBox(content) {
        removeOverlays(content);

        if (!isEnabled()) {
            return;
        }

        var markers = buildMarkers(content);
        var range = getTimeRange(markers);
        var startX;
        var endX;
        var overlay;
        var left;
        var width;

        if (!range) {
            return;
        }

        startX = getPositionForTime(markers, range.start);
        endX = getPositionForTime(markers, range.end);

        if (startX === null || endX === null || endX <= startX) {
            return;
        }

        left = Math.round(startX);
        width = Math.max(1, Math.round(endX - startX));

        ensureHostPosition(content);

        overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.position = 'absolute';
        overlay.style.left = left + 'px';
        overlay.style.top = getNumberPref('timelineBoxTop', 0) + 'px';
        overlay.style.width = width + 'px';
        overlay.style.height = Math.max(1, getNumberPref('timelineBoxHeight', 44)) + 'px';
        overlay.style.boxSizing = 'border-box';
        overlay.style.background = getStringPref('timelineBoxFill', 'rgba(255, 255, 255, 0.16)');
        overlay.style.border = getStringPref('timelineBoxBorder', '2px solid rgba(255, 255, 255, 0.75)');
        overlay.style.borderRadius = '4px';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '9999';
        overlay.style.mixBlendMode = 'normal';

        content.appendChild(overlay);
    }

    function updateAll() {
        rafId = 0;
        var contents = findTimelineContents(document);
        for (var i = 0; i < contents.length; i++) {
            drawBox(contents[i]);
        }
    }

    function scheduleUpdate() {
        if (rafId) {
            return;
        }

        rafId = window.requestAnimationFrame(updateAll);
    }

    function isOverlayOnlyMutation(mutation) {
        var i;

        if (mutation.target && mutation.target.classList && mutation.target.classList.contains(OVERLAY_CLASS)) {
            return true;
        }

        for (i = 0; i < mutation.addedNodes.length; i++) {
            if (!(mutation.addedNodes[i].classList && mutation.addedNodes[i].classList.contains(OVERLAY_CLASS))) {
                return false;
            }
        }

        for (i = 0; i < mutation.removedNodes.length; i++) {
            if (!(mutation.removedNodes[i].classList && mutation.removedNodes[i].classList.contains(OVERLAY_CLASS))) {
                return false;
            }
        }

        return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
    }

    function cleanupHostPositions() {
        var hosts = document.querySelectorAll('[data-' + HOST_DATA_ATTR.replace(/[A-Z]/g, function(ch) {
            return '-' + ch.toLowerCase();
        }) + ']');

        for (var i = 0; i < hosts.length; i++) {
            if (hosts[i].dataset[HOST_DATA_ATTR] === 'static') {
                hosts[i].style.position = '';
            }
            delete hosts[i].dataset[HOST_DATA_ATTR];
        }
    }

    scheduleUpdate();

    observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (!isOverlayOnlyMutation(mutations[i])) {
                scheduleUpdate();
                return;
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style', 'class']
    });

    window.addEventListener('resize', scheduleUpdate);

    window.__myScriptCleanup = function() {
        if (observer) {
            observer.disconnect();
        }
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        window.removeEventListener('resize', scheduleUpdate);
        removeOverlays(document);
        cleanupHostPositions();
    };
})();
