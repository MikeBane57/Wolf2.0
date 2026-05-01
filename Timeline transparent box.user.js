// ==UserScript==
// @name         Timeline transparent box
// @namespace    Wolf 2.0
// @version      0.7.0
// @description  Double-click the Ops Suite timeline to draw and adjust a transparent time-range box
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"timelineBoxEnabled":{"type":"boolean","group":"Timeline box","label":"Enable timeline box","description":"When enabled, double-click the timeline to show the box and double-click the box to dismiss it.","default":true},"timelineBoxStart":{"type":"string","group":"Timeline box","label":"Start","description":"Accepted examples: May 1 09:00, May 1 2026 09:00, 2026-05-01 09:00, or 09:00 for the first visible timeline date.","default":"","placeholder":"May 1 09:00"},"timelineBoxEnd":{"type":"string","group":"Timeline box","label":"End","description":"Same format as Start. Dragging/resizing the box saves an adjusted range in this browser.","default":"","placeholder":"May 1 12:00"},"timelineBoxTop":{"type":"number","group":"Timeline box","label":"Top offset (px)","description":"Vertical offset from the top of the timeline before the box extends to the bottom of the browser window.","default":0,"min":-2000,"max":2000,"step":1},"timelineBoxHeight":{"type":"number","group":"Timeline box","label":"Minimum height (px)","description":"The box normally extends to the bottom of the browser window; this is only a minimum height.","default":44,"min":1,"max":2000,"step":1},"timelineBoxLayer":{"type":"number","group":"Timeline box","label":"Layer / z-index","description":"Raise or lower the box in the page stack. Default 6. Increase if you need to drag/resize above more page elements; decrease if page elements should sit above the box.","default":6,"min":-10,"max":2147483647,"step":1},"timelineBoxFillColor":{"type":"select","group":"Timeline box","label":"Fill color preset","description":"Choose a preset color; opacity is controlled separately below.","default":"white","options":[{"value":"white","label":"White - neutral highlight"},{"value":"cyan","label":"Cyan - today/current example"},{"value":"yellow","label":"Yellow - caution/attention example"},{"value":"red","label":"Red - past/problem example"},{"value":"purple","label":"Purple - future/example"},{"value":"green","label":"Green - go/ok example"},{"value":"blue","label":"Blue - information example"},{"value":"orange","label":"Orange - watch/priority example"}]},"timelineBoxFillOpacity":{"type":"number","group":"Timeline box","label":"Fill opacity","description":"0 = invisible, 1 = solid.","default":0.16,"min":0,"max":1,"step":0.01},"timelineBoxBorderColor":{"type":"select","group":"Timeline box","label":"Border color preset","description":"Choose a preset color; opacity and width are controlled separately below.","default":"white","options":[{"value":"white","label":"White - neutral outline"},{"value":"cyan","label":"Cyan - today/current example"},{"value":"yellow","label":"Yellow - caution/attention example"},{"value":"red","label":"Red - past/problem example"},{"value":"purple","label":"Purple - future/example"},{"value":"green","label":"Green - go/ok example"},{"value":"blue","label":"Blue - information example"},{"value":"orange","label":"Orange - watch/priority example"}]},"timelineBoxBorderOpacity":{"type":"number","group":"Timeline box","label":"Border opacity","description":"0 = invisible, 1 = solid.","default":0.75,"min":0,"max":1,"step":0.01},"timelineBoxBorderWidth":{"type":"number","group":"Timeline box","label":"Border width (px)","default":2,"min":0,"max":20,"step":1}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Timeline%20transparent%20box.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Timeline%20transparent%20box.user.js
// ==/UserScript==

(function() {
    'use strict';

    var OVERLAY_CLASS = 'dc-timeline-transparent-box';
    var HANDLE_CLASS = 'dc-timeline-transparent-box-handle';
    var STYLE_ID = 'dc-timeline-transparent-box-style';
    var STORAGE_KEY = 'dc.timelineTransparentBox.range';
    var PASS_THROUGH_SELECTOR = [
        '[data-qe-id="as-flight-leg"]',
        '[data-qe-id="as-flight-leg-puck"]',
        '[data-linked-hover-id]',
        '[data-mid-click-bound]',
        'button',
        'a',
        'input',
        'select',
        'textarea',
        '[role="button"]',
        '[role="menuitem"]',
        '[tabindex]'
    ].join(',');
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
    var dragState = null;
    var scrollParents = [];
    var boxVisible = false;
    var currentBox = null;

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

    function getOpacityPref(key, defaultValue) {
        return clamp(getNumberPref(key, defaultValue), 0, 1);
    }

    function isEnabled() {
        return getPref('timelineBoxEnabled', true) !== false;
    }

    function clamp(n, min, max) {
        return Math.min(max, Math.max(min, n));
    }

    function normalizeHexColor(value, fallback) {
        var text = String(value || '').trim();
        if (/^#[0-9a-f]{6}$/i.test(text)) {
            return text;
        }
        if (/^#[0-9a-f]{3}$/i.test(text)) {
            return '#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
        }
        return fallback;
    }

    function resolvePresetColor(value, fallback) {
        var presets = {
            white: '#ffffff',
            yellow: '#ffd54f',
            cyan: '#48d1cc',
            purple: '#bb86fa',
            red: '#ff8282',
            green: '#7bd88f',
            blue: '#64b5f6',
            orange: '#ffb74d',
            gray: '#b0bec5'
        };
        var key = String(value || '').trim().toLowerCase();
        return presets[key] || normalizeHexColor(value, fallback);
    }

    function hexToRgb(hex) {
        var normalized = normalizeHexColor(hex, '#ffffff').slice(1);
        return {
            r: parseInt(normalized.slice(0, 2), 16),
            g: parseInt(normalized.slice(2, 4), 16),
            b: parseInt(normalized.slice(4, 6), 16)
        };
    }

    function rgbaFromHex(hex, opacity) {
        var rgb = hexToRgb(hex);
        return 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + opacity + ')';
    }

    function getBoxBackground() {
        return rgbaFromHex(
            resolvePresetColor(getStringPref('timelineBoxFillColor', 'white'), '#ffffff'),
            getOpacityPref('timelineBoxFillOpacity', 0.16)
        );
    }

    function getBoxBorder() {
        var width = Math.max(0, getNumberPref('timelineBoxBorderWidth', 2));
        return width + 'px solid ' + rgbaFromHex(
            resolvePresetColor(getStringPref('timelineBoxBorderColor', 'white'), '#ffffff'),
            getOpacityPref('timelineBoxBorderOpacity', 0.75)
        );
    }

    function getBoxLayer() {
        return Math.round(clamp(getNumberPref('timelineBoxLayer', 6), -2147483648, 2147483647));
    }

    function readBoxVisible() {
        return false;
    }

    function setBoxVisible(visible) {
        boxVisible = !!visible;
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

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '.' + OVERLAY_CLASS + '{position:fixed;box-sizing:border-box;border-radius:4px;' +
            'pointer-events:none;touch-action:none;user-select:none;mix-blend-mode:normal;}' +
            '.' + HANDLE_CLASS + '{position:absolute;top:-2px;bottom:-2px;width:12px;z-index:1;pointer-events:none;}' +
            '.' + HANDLE_CLASS + '[data-side="left"]{left:-6px;cursor:ew-resize;}' +
            '.' + HANDLE_CLASS + '[data-side="right"]{right:-6px;cursor:ew-resize;}' +
            '.' + OVERLAY_CLASS + '::after{content:"";position:absolute;inset:0;pointer-events:none;' +
            'box-shadow:inset 0 0 0 1px rgba(0,0,0,.25);}';
        document.head.appendChild(style);
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

    function readStoredRange() {
        var parsed;
        try {
            parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
        } catch (e) {
            return null;
        }

        if (!parsed || !Number.isFinite(parsed.start) || !Number.isFinite(parsed.end) || parsed.end <= parsed.start) {
            return null;
        }

        return {
            start: parsed.start,
            end: parsed.end
        };
    }

    function saveStoredRange(start, end) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            start: Math.round(start),
            end: Math.round(end)
        }));
    }

    function clearStoredRange() {
        window.localStorage.removeItem(STORAGE_KEY);
    }

    function getDefaultRange() {
        var now = new Date();
        now.setMinutes(0, 0, 0);

        return {
            start: now.getTime(),
            end: now.getTime() + 60 * 60 * 1000
        };
    }

    function getTimeRange(markers) {
        var storedRange = readStoredRange();
        var startText = getStringPref('timelineBoxStart', '');
        var endText = getStringPref('timelineBoxEnd', '');
        var range;
        var start;
        var end;

        if (storedRange && isRangeVisible(markers, storedRange)) {
            return storedRange;
        }
        if (storedRange) {
            clearStoredRange();
        }

        if (!startText && !endText) {
            range = getDefaultRange();
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

    function isRangeVisible(markers, range) {
        return getPositionForTime(markers, range.start) !== null &&
            getPositionForTime(markers, range.end) !== null;
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

    function getTimeForPosition(markers, targetX) {
        var last;

        if (!markers.length) {
            return null;
        }

        for (var i = 0; i < markers.length - 1; i++) {
            var a = markers[i];
            var b = markers[i + 1];

            if (targetX >= a.x && targetX <= b.x) {
                var spanX = b.x - a.x;
                var spanTime = b.time - a.time;
                if (spanX <= 0 || spanTime <= 0) {
                    return a.time;
                }
                return a.time + spanTime * ((targetX - a.x) / spanX);
            }
        }

        last = markers[markers.length - 1];
        if (targetX >= last.x && targetX <= last.x + last.width) {
            return last.time + 60 * 60 * 1000 * ((targetX - last.x) / last.width);
        }

        return null;
    }

    function getRangeDuration(markers) {
        var range = getTimeRange(markers);

        if (range && range.end > range.start) {
            return range.end - range.start;
        }

        return 60 * 60 * 1000;
    }

    function centerRangeOnEvent(content, event) {
        var markers = buildMarkers(content);
        var contentRect;
        var clickedX;
        var centerTime;
        var duration;
        var timelineStart;
        var timelineEnd;
        var start;
        var end;

        if (!markers.length) {
            return false;
        }

        contentRect = content.getBoundingClientRect();
        clickedX = event.clientX - contentRect.left;
        centerTime = getTimeForPosition(markers, clickedX);
        if (centerTime === null) {
            return false;
        }

        duration = getRangeDuration(markers);
        timelineStart = markers[0].time;
        timelineEnd = markers[markers.length - 1].time + 60 * 60 * 1000;
        start = centerTime - duration / 2;
        end = start + duration;

        if (start < timelineStart) {
            start = timelineStart;
            end = start + duration;
        }
        if (end > timelineEnd) {
            end = timelineEnd;
            start = end - duration;
        }
        if (start < timelineStart) {
            start = timelineStart;
        }

        saveStoredRange(start, end);
        return true;
    }

    function getTimelineBounds(markers) {
        var last = markers[markers.length - 1];
        return {
            minX: markers[0].x,
            maxX: last.x + last.width
        };
    }

    function removeOverlays(root) {
        var overlays = root.querySelectorAll ? root.querySelectorAll('.' + OVERLAY_CLASS) : [];
        for (var i = 0; i < overlays.length; i++) {
            overlays[i].remove();
        }
        currentBox = null;
    }

    function positionOverlay(overlay, content, left, width) {
        var contentRect = content.getBoundingClientRect();
        var top = contentRect.top + getNumberPref('timelineBoxTop', 0);
        var minHeight = Math.max(1, getNumberPref('timelineBoxHeight', 44));
        var height = Math.max(minHeight, window.innerHeight - top);

        overlay.style.left = Math.round(contentRect.left + left) + 'px';
        overlay.style.top = Math.round(top) + 'px';
        overlay.style.width = Math.max(1, Math.round(width)) + 'px';
        overlay.style.height = Math.max(1, Math.round(height)) + 'px';
    }

    function createHandle(side) {
        var handle = document.createElement('div');
        handle.className = HANDLE_CLASS;
        handle.setAttribute('data-side', side);
        return handle;
    }

    function beginDrag(event, overlay, content, markers, left, width, mode) {
        var bounds = getTimelineBounds(markers);

        if (event.button !== 0 || !bounds) {
            return;
        }

        dragState = {
            mode: mode || 'move',
            overlay: overlay,
            content: content,
            markers: markers,
            startClientX: event.clientX,
            startLeft: left,
            startWidth: width,
            minX: bounds.minX,
            maxX: bounds.maxX
        };

        event.preventDefault();
        event.stopPropagation();

        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', endDrag, true);
        window.addEventListener('pointercancel', endDrag, true);
    }

    function getAdjustedDragRect(event) {
        var dx = event.clientX - dragState.startClientX;
        var left = dragState.startLeft;
        var width = dragState.startWidth;
        var minWidth = 6;

        if (dragState.mode === 'left') {
            left = clamp(dragState.startLeft + dx, dragState.minX, dragState.startLeft + dragState.startWidth - minWidth);
            width = dragState.startWidth + (dragState.startLeft - left);
        } else if (dragState.mode === 'right') {
            width = clamp(dragState.startWidth + dx, minWidth, dragState.maxX - dragState.startLeft);
        } else {
            left = clamp(dragState.startLeft + dx, dragState.minX, dragState.maxX - dragState.startWidth);
        }

        return {
            left: left,
            width: width
        };
    }

    function onPointerMove(event) {
        var rect;

        if (!dragState) {
            return;
        }

        rect = getAdjustedDragRect(event);
        positionOverlay(dragState.overlay, dragState.content, rect.left, rect.width);

        event.preventDefault();
        event.stopPropagation();
    }

    function endDrag(event) {
        var rect;
        var startTime;
        var endTime;

        if (!dragState) {
            return;
        }

        rect = getAdjustedDragRect(event);
        startTime = getTimeForPosition(dragState.markers, rect.left);
        endTime = getTimeForPosition(dragState.markers, rect.left + rect.width);

        if (startTime !== null && endTime !== null && endTime > startTime) {
            saveStoredRange(startTime, endTime);
        }

        dragState = null;
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', endDrag, true);
        window.removeEventListener('pointercancel', endDrag, true);
        scheduleUpdate();

        event.preventDefault();
        event.stopPropagation();
    }

    function drawBox(content) {
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

        if (!markers.length || !range) {
            return;
        }

        startX = getPositionForTime(markers, range.start);
        endX = getPositionForTime(markers, range.end);

        if (startX === null || endX === null || endX <= startX) {
            return;
        }

        left = Math.round(startX);
        width = Math.max(1, Math.round(endX - startX));

        overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.background = getBoxBackground();
        overlay.style.border = getBoxBorder();
        overlay.style.zIndex = String(getBoxLayer());

        positionOverlay(overlay, content, left, width);
        document.body.insertBefore(overlay, document.body.firstChild);

        currentBox = {
            overlay: overlay,
            content: content,
            markers: markers,
            left: left,
            width: width
        };
    }

    function isPointInCurrentBox(event) {
        var rect;

        if (!currentBox || !currentBox.overlay) {
            return false;
        }

        rect = currentBox.overlay.getBoundingClientRect();
        return event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;
    }

    function shouldPassThroughTarget(target) {
        return !!(target && target.closest && target.closest(PASS_THROUGH_SELECTOR));
    }

    function getDragModeForPoint(event) {
        var rect = currentBox.overlay.getBoundingClientRect();
        var edgeSlop = 12;

        if (event.clientX <= rect.left + edgeSlop) {
            return 'left';
        }
        if (event.clientX >= rect.right - edgeSlop) {
            return 'right';
        }
        return 'move';
    }

    function isTimelineContent(content) {
        var hourColumns = 0;
        var children = content && content.children ? content.children : [];

        for (var i = 0; i < children.length; i++) {
            if (getHourTextFromColumn(children[i])) {
                hourColumns++;
                if (hourColumns >= 6) {
                    return true;
                }
            }
        }

        return false;
    }

    function findTimelineContentForEvent(event) {
        var node = event.target && event.target.nodeType === 1 ? event.target : null;
        var container;
        var contents;
        var rect;

        if (node && node.closest) {
            container = node.closest('[data-dragscroll]');
            if (container && container.firstElementChild && isTimelineContent(container.firstElementChild)) {
                return container.firstElementChild;
            }
        }

        contents = findTimelineContents(document);
        for (var i = 0; i < contents.length; i++) {
            container = contents[i].parentElement;
            if (!container) {
                continue;
            }
            rect = container.getBoundingClientRect();
            if (event.clientX >= rect.left &&
                event.clientX <= rect.right &&
                event.clientY >= rect.top &&
                event.clientY <= rect.bottom) {
                return contents[i];
            }
        }

        return null;
    }

    function onDocumentDblClick(event) {
        var content;

        if (!isEnabled()) {
            return;
        }

        if (isPointInCurrentBox(event) && !shouldPassThroughTarget(event.target)) {
            setBoxVisible(false);
            event.preventDefault();
            event.stopPropagation();
            scheduleUpdate();
            return;
        }

        content = findTimelineContentForEvent(event);
        if (content) {
            centerRangeOnEvent(content, event);
            setBoxVisible(true);
            event.preventDefault();
            event.stopPropagation();
            scheduleUpdate();
        }
    }

    function onDocumentPointerDown(event) {
        if (!isEnabled() || !boxVisible || !isPointInCurrentBox(event) || shouldPassThroughTarget(event.target)) {
            return;
        }

        beginDrag(
            event,
            currentBox.overlay,
            currentBox.content,
            currentBox.markers,
            currentBox.left,
            currentBox.width,
            getDragModeForPoint(event)
        );
    }

    function updateScrollParents(contents) {
        var seen = [];

        for (var i = 0; i < scrollParents.length; i++) {
            scrollParents[i].removeEventListener('scroll', scheduleUpdate, true);
        }
        scrollParents = [];

        for (var j = 0; j < contents.length; j++) {
            var node = contents[j].parentElement;
            while (node && node !== document.body) {
                var style = window.getComputedStyle(node);
                if (/(auto|scroll|hidden)/.test(style.overflow + style.overflowX + style.overflowY) && seen.indexOf(node) === -1) {
                    seen.push(node);
                    node.addEventListener('scroll', scheduleUpdate, true);
                    scrollParents.push(node);
                }
                node = node.parentElement;
            }
        }
    }

    function updateAll() {
        rafId = 0;

        if (dragState) {
            return;
        }

        injectStyle();
        removeOverlays(document);

        var contents = findTimelineContents(document);
        updateScrollParents(contents);

        if (boxVisible) {
            for (var i = 0; i < contents.length; i++) {
                drawBox(contents[i]);
            }
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

    boxVisible = false;
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
    window.addEventListener('scroll', scheduleUpdate, true);
    document.addEventListener('dblclick', onDocumentDblClick, true);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);

    window.__myScriptCleanup = function() {
        if (observer) {
            observer.disconnect();
        }
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        if (dragState) {
            window.removeEventListener('pointermove', onPointerMove, true);
            window.removeEventListener('pointerup', endDrag, true);
            window.removeEventListener('pointercancel', endDrag, true);
            dragState = null;
        }
        for (var i = 0; i < scrollParents.length; i++) {
            scrollParents[i].removeEventListener('scroll', scheduleUpdate, true);
        }
        scrollParents = [];
        window.removeEventListener('resize', scheduleUpdate);
        window.removeEventListener('scroll', scheduleUpdate, true);
        document.removeEventListener('dblclick', onDocumentDblClick, true);
        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        removeOverlays(document);
        var style = document.getElementById(STYLE_ID);
        if (style) {
            style.remove();
        }
    };
})();
