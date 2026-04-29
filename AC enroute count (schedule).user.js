// ==UserScript==
// @name         AC enroute count (schedule)
// @namespace    Wolf 2.0
// @version      1.2.1
// @description  Bar color match by default (opacity filter optional OFF). Console logs each match when debug pref ON (default ON).
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @donkeycode-pref {"acEnrouteEnabled":{"type":"boolean","group":"AC enroute","label":"Show enroute count","description":"When ON, insert AC enroute next to A/C ON THE GROUND and refresh as legs change.","default":true},"acEnrouteActiveBarColors":{"type":"string","group":"AC enroute","label":"Active leg bar colors (hex)","description":"Comma-separated target blues for the schedule bar. Matching uses RGB distance (computed color rarely equals hex exactly). Default #3390ef,#abcdf8.","default":"#3390ef,#abcdf8","placeholder":"#3390ef,#abcdf8"},"acEnrouteBarColorDistance":{"type":"number","group":"AC enroute","label":"Bar color match tolerance (0-255)","description":"Max Euclidean RGB distance from a target blue to count the leg bar as active. Raise if counts stay 0; lower if wrong legs match. Default 55.","default":55,"min":5,"max":120,"step":1},"acEnrouteExcludeLowOpacityBar":{"type":"boolean","group":"AC enroute","label":"Exclude low-opacity bars (optional)","description":"OFF by default — enroute legs often use the same opacity as completed (e.g. 0.4). Turn ON only if you want to hide faded bars using the threshold below.","default":false},"acEnrouteBarOpacityMin":{"type":"number","group":"AC enroute","label":"Minimum bar opacity if exclusion ON","description":"Counted only if bar opacity is strictly greater than this (example: 0.39 passes when threshold is 0.4). Default 0.4.","default":0.4,"min":0,"max":1,"step":0.05},"acEnrouteDebugMatchLog":{"type":"boolean","group":"AC enroute · debug","label":"Log matching flights to page console","description":"When ON, each counted leg logs dep→arr, flight # if found, bar RGB distance, and opacity. Turn OFF after tuning. Default ON for troubleshooting.","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20enroute%20count%20(schedule).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20enroute%20count%20(schedule).user.js
// ==/UserScript==

(function () {
    'use strict';

    var HOST_ROW_ATTR = 'data-dc-ac-enroute-row';
    var LABEL_TEXT = 'AC enroute';
    var LEG_QE = '[data-qe-id="as-flight-leg"]';
    var PUCK_QE = '[data-qe-id="as-flight-leg-puck"]';
    /** Same obfuscated class as Completed flight opacity — schedule bar fill behind the leg */
    var SCHED_BAR_SEL = '.vVzbj3J5m70\\=';
    /** Station code cells on puck — arrival uses distinct second class (see ops map markup). */
    var STATION_CELL_SUBSEL = '[class*="tg9Iiv9oAOo="]';
    /** Departure airport cell pairs base station class with this token (ops map) */
    var DEP_STATION_EXTRA_SUBSEL = '[class*="zbA1EvKL1Bo="]';
    /** Arrival airport cell — pairs tg9Iiv9oAOo with this token */
    var ARR_STATION_EXTRA_SUBSEL = '[class*="Ziu3-r4LY1M="]';
    var STATION_COMBO = 'div[name="station"][role="combobox"]';

    var mo = null;
    var debounceTimer = null;
    var groundMo = null;
    var stationMo = null;

    function getPref(key, def) {
        if (typeof donkeycodeGetPref !== 'function') {
            return def;
        }
        var v = donkeycodeGetPref(key);
        if (v === undefined || v === null || v === '') {
            return def;
        }
        return v;
    }

    function boolPref(key, def) {
        var v = getPref(key, def);
        return v === true || v === 'true';
    }

    function parseHexToRgb(hex) {
        var h = String(hex || '').trim().toLowerCase();
        if (!/^#[0-9a-f]{6}$/.test(h)) {
            return null;
        }
        return {
            r: parseInt(h.slice(1, 3), 16),
            g: parseInt(h.slice(3, 5), 16),
            b: parseInt(h.slice(5, 7), 16)
        };
    }

    function parseEnrouteBarTargetRgbs() {
        var raw = String(getPref('acEnrouteActiveBarColors', '#3390ef,#abcdf8') || '');
        var parts = raw.split(',');
        var out = [];
        var i;
        for (i = 0; i < parts.length; i++) {
            var rgb = parseHexToRgb(parts[i]);
            if (rgb) {
                out.push(rgb);
            }
        }
        if (!out.length) {
            out.push(parseHexToRgb('#3390ef'));
            out.push(parseHexToRgb('#abcdf8'));
        }
        return out;
    }

    function rgbDistance(a, b) {
        if (!a || !b) {
            return 9999;
        }
        var dr = a.r - b.r;
        var dg = a.g - b.g;
        var db = a.b - b.b;
        return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    function cssColorToHex(cssVal) {
        if (!cssVal || typeof cssVal !== 'string') {
            return '';
        }
        var s = cssVal.trim();
        if (/^#[0-9a-f]{6}$/i.test(s)) {
            return s.toLowerCase();
        }
        var mrgba = s.match(
            /^rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/i
        );
        if (mrgba) {
            var al = parseFloat(mrgba[4]);
            if (Number.isFinite(al) && al < 0.06) {
                return '';
            }
        }
        var m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (!m) {
            return '';
        }
        var r = parseInt(m[1], 10);
        var g = parseInt(m[2], 10);
        var b = parseInt(m[3], 10);
        if (![r, g, b].every(function (x) {
            return x >= 0 && x <= 255;
        })) {
            return '';
        }
        return (
            '#' +
            ('0' + r.toString(16)).slice(-2) +
            ('0' + g.toString(16)).slice(-2) +
            ('0' + b.toString(16)).slice(-2)
        );
    }

    function rgbaToRgbTuple(cssVal) {
        var hex = cssColorToHex(cssVal);
        if (!hex) {
            return null;
        }
        return parseHexToRgb(hex);
    }

    function effectiveBackgroundRgb(el) {
        if (!el) {
            return null;
        }
        var cur = el;
        var hop = 0;
        while (cur && hop < 8) {
            var cs = null;
            try {
                cs = window.getComputedStyle(cur);
            } catch (e) {
                cs = null;
            }
            if (cs) {
                var bg = cs.backgroundColor;
                if (bg && /transparent|none/i.test(String(bg).trim())) {
                    cur = cur.parentElement;
                    hop++;
                    continue;
                }
                var rgb = rgbaToRgbTuple(bg);
                if (rgb) {
                    return rgb;
                }
            }
            cur = cur.parentElement;
            hop++;
        }
        return null;
    }

    /** Inline opacity from bar element (falls back to computed). */
    function barOpacityFromEl(barEl) {
        if (!barEl) {
            return 1;
        }
        try {
            var st = barEl.getAttribute('style') || '';
            var om = st.match(/opacity\s*:\s*([\d.]+)/i);
            if (om) {
                var o = parseFloat(om[1]);
                if (Number.isFinite(o)) {
                    return o;
                }
            }
        } catch (e) {}
        var op = 1;
        try {
            op = parseFloat(window.getComputedStyle(barEl).opacity);
        } catch (e2) {}
        return Number.isFinite(op) ? op : 1;
    }

    function analyzeScheduleBar(barEl, targetRgbs, maxDist, opacityGate) {
        var out = {
            passesOpacity: true,
            passesColor: false,
            minDist: 9999,
            opacity: 1,
            bgRgb: null
        };
        if (!barEl) {
            return out;
        }
        out.opacity = barOpacityFromEl(barEl);
        if (opacityGate && opacityGate.enabled) {
            out.passesOpacity = out.opacity > opacityGate.minOpacity + 1e-6;
        }
        var px = effectiveBackgroundRgb(barEl);
        out.bgRgb = px;
        if (!px) {
            return out;
        }
        var minD = 9999;
        var ti;
        for (ti = 0; ti < targetRgbs.length; ti++) {
            var d = rgbDistance(px, targetRgbs[ti]);
            if (d < minD) {
                minD = d;
            }
        }
        out.minDist = minD;
        out.passesColor = minD <= maxDist;
        return out;
    }

    /** Best-effort flight number from leg DOM (sibling of bar before puck). */
    function flightNumberFromLeg(leg, bar, puck) {
        if (!leg || !bar) {
            return '';
        }
        var n = bar.nextElementSibling;
        while (n && puck && n !== puck) {
            var t = String(n.textContent || '')
                .replace(/\s+/g, '')
                .trim();
            if (/^\d{1,4}$/.test(t)) {
                return t;
            }
            n = n.nextElementSibling;
        }
        return '';
    }

    function readSelectedStationCode() {
        var combo = document.querySelector(STATION_COMBO);
        if (!combo) {
            return '';
        }
        var dv = combo.querySelector('.divider.text');
        if (dv) {
            var t = String(dv.textContent || '').trim();
            if (/^[A-Z]{3}$/.test(t)) {
                return t;
            }
        }
        var sel = combo.querySelector('.item.active.selected .text, [aria-selected="true"] .text');
        if (sel) {
            var t2 = String(sel.textContent || '').trim();
            if (/^[A-Z]{3}$/.test(t2)) {
                return t2;
            }
        }
        return '';
    }

    function airportsFromPuck(puck) {
        if (!puck || !puck.querySelectorAll) {
            return [];
        }
        var nodes = puck.querySelectorAll(STATION_CELL_SUBSEL);
        var out = [];
        var i;
        for (i = 0; i < nodes.length; i++) {
            var txt = String(nodes[i].textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (/^[A-Z]{3}$/.test(txt)) {
                out.push(txt);
            }
        }
        return out;
    }

    function departureStationFromPuck(puck) {
        if (!puck || !puck.querySelector) {
            return '';
        }
        var depEl =
            puck.querySelector(STATION_CELL_SUBSEL + DEP_STATION_EXTRA_SUBSEL) ||
            null;
        if (depEl) {
            var d = String(depEl.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (/^[A-Z]{3}$/.test(d)) {
                return d;
            }
        }
        var ap = airportsFromPuck(puck);
        return ap.length >= 1 ? ap[0] : '';
    }

    function arrivalStationFromPuck(puck) {
        if (!puck || !puck.querySelector) {
            return '';
        }
        var arrEl =
            puck.querySelector(STATION_CELL_SUBSEL + ARR_STATION_EXTRA_SUBSEL) ||
            puck.querySelector(ARR_STATION_EXTRA_SUBSEL);
        if (arrEl) {
            var a = String(arrEl.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (/^[A-Z]{3}$/.test(a)) {
                return a;
            }
        }
        var ap = airportsFromPuck(puck);
        return ap.length >= 2 ? ap[1] : '';
    }

    function countEnrouteToStation(station, targetRgbs, maxDist, opacityGate, debugLog) {
        if (!station) {
            return 0;
        }
        var legs = document.querySelectorAll(LEG_QE);
        var n = 0;
        var li;
        for (li = 0; li < legs.length; li++) {
            var leg = legs[li];
            var bar = leg.querySelector(SCHED_BAR_SEL);
            var barInfo = analyzeScheduleBar(bar, targetRgbs, maxDist, opacityGate);
            if (!barInfo.passesOpacity || !barInfo.passesColor) {
                continue;
            }
            var puckLeg = leg.querySelector(PUCK_QE);
            var arr = arrivalStationFromPuck(puckLeg);
            var dep = departureStationFromPuck(puckLeg);
            if (!arr || arr !== station) {
                continue;
            }
            /** Inbound to map station only — exclude outbound from hub (e.g. DAL→DEN). */
            if (dep && dep === station) {
                continue;
            }
            n++;
            if (debugLog) {
                var rgb = barInfo.bgRgb;
                var hex =
                    rgb
                        ? '#' +
                          ('0' + rgb.r.toString(16)).slice(-2) +
                          ('0' + rgb.g.toString(16)).slice(-2) +
                          ('0' + rgb.b.toString(16)).slice(-2)
                        : '(no bg)';
                try {
                    console.log('[AC enroute] MATCH', {
                        mapStation: station,
                        dep: dep || '?',
                        arr: arr,
                        flight: flightNumberFromLeg(leg, bar, puckLeg) || undefined,
                        barRgbDist: Math.round(barInfo.minDist * 10) / 10,
                        barOpacity: Math.round(barInfo.opacity * 1000) / 1000,
                        barEffectiveHex: hex,
                        hoverId:
                            puckLeg && puckLeg.getAttribute
                                ? puckLeg.getAttribute('data-linked-hover-id')
                                : undefined
                    });
                } catch (logErr) {}
            }
        }
        return n;
    }

    function findGroundStatRow() {
        var divs = document.querySelectorAll('div');
        var i;
        for (i = 0; i < divs.length; i++) {
            var row = divs[i];
            if (row.children.length !== 2) {
                continue;
            }
            var label = String(row.children[0].textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!/^A\/C\s+ON\s+THE\s+GROUND$/i.test(label)) {
                continue;
            }
            var numTxt = String(row.children[1].textContent || '').trim();
            if (/^\d+$/.test(numTxt)) {
                return row;
            }
        }
        for (i = 0; i < divs.length; i++) {
            var el = divs[i];
            if (el.children.length !== 2) {
                continue;
            }
            var lab = String(el.children[0].textContent || '').replace(/\s+/g, ' ').trim();
            if (/ON\s+THE\s+GROUND/i.test(lab) && lab.length < 40) {
                return el;
            }
        }
        return null;
    }

    function ensureEnrouteRow() {
        var existing = document.querySelector('[' + HOST_ROW_ATTR + '="1"]');
        var groundRow = findGroundStatRow();
        if (!groundRow || !groundRow.parentNode) {
            if (existing) {
                try {
                    existing.remove();
                } catch (e) {}
            }
            return;
        }

        var row = existing;
        if (!row) {
            row = document.createElement('div');
            row.setAttribute(HOST_ROW_ATTR, '1');
            try {
                row.className = groundRow.className || '';
            } catch (e) {}

            var lab = document.createElement('div');
            var val = document.createElement('div');
            if (groundRow.children.length >= 2) {
                lab.className = groundRow.children[0].className || '';
                val.className = groundRow.children[1].className || '';
            }
            lab.textContent = LABEL_TEXT;
            val.setAttribute('data-dc-ac-enroute-val', '1');
            val.textContent = '0';

            row.appendChild(lab);
            row.appendChild(val);

            try {
                groundRow.parentNode.insertBefore(row, groundRow.nextSibling);
            } catch (e2) {
                groundRow.insertAdjacentElement('afterend', row);
            }
        }

        var valEl = row.querySelector('[data-dc-ac-enroute-val="1"]');
        if (!valEl) {
            return;
        }

        var st = readSelectedStationCode();
        var rgbs = parseEnrouteBarTargetRgbs();
        var tol = Number(getPref('acEnrouteBarColorDistance', 55));
        if (!Number.isFinite(tol)) {
            tol = 55;
        }
        tol = Math.min(120, Math.max(5, tol));
        var exLow = boolPref('acEnrouteExcludeLowOpacityBar', false);
        var opMin = Number(getPref('acEnrouteBarOpacityMin', 0.4));
        if (!Number.isFinite(opMin)) {
            opMin = 0.4;
        }
        opMin = Math.min(1, Math.max(0, opMin));
        var opacityGate = exLow ? { enabled: true, minOpacity: opMin } : { enabled: false, minOpacity: 0 };
        var dbg = boolPref('acEnrouteDebugMatchLog', true);
        var cnt = countEnrouteToStation(st, rgbs, tol, opacityGate, dbg);
        valEl.textContent = String(cnt);
        valEl.title =
            st
                ? 'Inbound to ' +
                  st +
                  ' (blue bar color match' +
                  (exLow ? '; opacity > ' + opMin : '') +
                  '; dep≠' +
                  st +
                  ')'
                : 'Select a station to count enroute flights';
    }

    function scheduleUpdate() {
        if (!boolPref('acEnrouteEnabled', true)) {
            var ex = document.querySelector('[' + HOST_ROW_ATTR + '="1"]');
            if (ex) {
                try {
                    ex.remove();
                } catch (e) {}
            }
            return;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(function () {
            debounceTimer = null;
            ensureEnrouteRow();
        }, 120);
    }

    function watchGroundArea() {
        var groundRow = findGroundStatRow();
        if (!groundRow || !groundRow.parentNode) {
            return;
        }
        if (groundMo) {
            groundMo.disconnect();
            groundMo = null;
        }
        try {
            groundMo = new MutationObserver(scheduleUpdate);
            groundMo.observe(groundRow.parentNode, { childList: true, subtree: true, characterData: true });
        } catch (e) {}
    }

    function watchStationComboEl() {
        var combo = document.querySelector(STATION_COMBO);
        if (!combo || combo.getAttribute('data-dc-ac-enroute-station-obs') === '1') {
            return;
        }
        combo.setAttribute('data-dc-ac-enroute-station-obs', '1');
        if (stationMo) {
            try {
                stationMo.disconnect();
            } catch (e) {}
            stationMo = null;
        }
        try {
            stationMo = new MutationObserver(scheduleUpdate);
            stationMo.observe(combo, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['aria-expanded', 'aria-activedescendant']
            });
        } catch (e2) {}
    }

    function init() {
        if (!boolPref('acEnrouteEnabled', true)) {
            return;
        }
        scheduleUpdate();
        watchGroundArea();
        watchStationComboEl();
        mo = new MutationObserver(function () {
            scheduleUpdate();
            watchGroundArea();
            watchStationComboEl();
        });
        try {
            mo.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.__myScriptCleanup = function () {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        if (mo) {
            try {
                mo.disconnect();
            } catch (e) {}
            mo = null;
        }
        if (groundMo) {
            try {
                groundMo.disconnect();
            } catch (e2) {}
            groundMo = null;
        }
        if (stationMo) {
            try {
                stationMo.disconnect();
            } catch (e4) {}
            stationMo = null;
        }
        try {
            var c = document.querySelector(STATION_COMBO + '[data-dc-ac-enroute-station-obs="1"]');
            if (c) {
                c.removeAttribute('data-dc-ac-enroute-station-obs');
            }
        } catch (e5) {}
        try {
            var r = document.querySelector('[' + HOST_ROW_ATTR + '="1"]');
            if (r) {
                r.remove();
            }
        } catch (e3) {}
        window.__myScriptCleanup = undefined;
    };
})();
