// ==UserScript==
// @name         AC enroute count (schedule)
// @namespace    Wolf 2.0
// @version      1.3.1
// @description  Count inbound enroute aircraft only when the station filter has a displayed value.
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @donkeycode-pref {"acEnrouteEnabled":{"type":"boolean","group":"AC enroute","label":"Show enroute count","description":"When ON, show AC enroute (next to ground stats or fixed HUD) and refresh as legs change.","default":true},"acEnrouteActiveBarColors":{"type":"string","group":"AC enroute","label":"Active leg bar colors (hex)","description":"Comma-separated target blues for the schedule bar. Matching uses RGB distance (computed color rarely equals hex exactly). Default #3390ef,#abcdf8.","default":"#3390ef,#abcdf8","placeholder":"#3390ef,#abcdf8"},"acEnrouteBarColorDistance":{"type":"number","group":"AC enroute","label":"Bar color match tolerance (0-255)","description":"Max Euclidean RGB distance from a target blue to count the leg bar as active. Raise if counts stay 0; lower if wrong legs match. Default 55.","default":55,"min":5,"max":120,"step":1},"acEnrouteExcludeLowOpacityBar":{"type":"boolean","group":"AC enroute","label":"Exclude low-opacity bars (optional)","description":"OFF by default — enroute legs often use the same opacity as completed (e.g. 0.4). Turn ON only if you want to hide faded bars using the threshold below.","default":false},"acEnrouteBarOpacityMin":{"type":"number","group":"AC enroute","label":"Minimum bar opacity if exclusion ON","description":"Counted only if bar opacity is strictly greater than this (example: 0.39 passes when threshold is 0.4). Default 0.4.","default":0.4,"min":0,"max":1,"step":0.05},"acEnrouteDebugMatchLog":{"type":"boolean","group":"AC enroute · debug","label":"Log each MATCH to page console","description":"Logs every counted leg (dep/arr, flight #, bar distance). Default ON during tuning.","default":true},"acEnrouteDebugTickLog":{"type":"boolean","group":"AC enroute · debug","label":"Log periodic scan summary (tick)","description":"Every ~4s while the map updates: leg count, bar matches, station filter. Proves the script is scanning. Default ON; turn OFF to reduce noise.","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20enroute%20count%20(schedule).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20enroute%20count%20(schedule).user.js
// ==/UserScript==

(function () {
    'use strict';

    var HOST_ROW_ATTR = 'data-dc-ac-enroute-row';
    var LABEL_TEXT = 'AC enroute';
    var LEG_QE = '[data-qe-id="as-flight-leg"]';
    var PUCK_QE = '[data-qe-id="as-flight-leg-puck"]';
    /** Schedule bar fill — base token survives SW UI churn; fallback to legacy exact class */
    var SCHED_BAR_CLASS_TOKEN = 'vVzbj3J5m70';
    var SCHED_BAR_SEL_LEGACY = '.vVzbj3J5m70\\=';
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
    var FLOAT_HOST_ATTR = 'data-dc-ac-enroute-float';
    var tickLogLastMs = 0;
    var TICK_LOG_MS = 4000;

    function findScheduleBarInLeg(leg) {
        if (!leg || !leg.querySelector) {
            return null;
        }
        var bar =
            leg.querySelector('[class*="' + SCHED_BAR_CLASS_TOKEN + '"]') ||
            leg.querySelector(SCHED_BAR_SEL_LEGACY);
        return bar || null;
    }

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
        var dv = combo.querySelector('.divider.text, .text.divider');
        if (dv) {
            if (dv.classList && dv.classList.contains('default')) {
                return '';
            }
            var t = String(dv.textContent || '').trim();
            if (/^[A-Z]{3}$/.test(t)) {
                return t;
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

    function scanEnrouteToStation(station, targetRgbs, maxDist, opacityGate, debugMatch) {
        var stats = {
            legCount: 0,
            barsFound: 0,
            barColorPass: 0,
            arrMatchStation: 0,
            skippedOutboundSameStation: 0
        };
        if (!station) {
            return { count: 0, stats: stats };
        }
        var legs = document.querySelectorAll(LEG_QE);
        stats.legCount = legs.length;
        var n = 0;
        var li;
        for (li = 0; li < legs.length; li++) {
            var leg = legs[li];
            var bar = findScheduleBarInLeg(leg);
            if (bar) {
                stats.barsFound++;
            }
            var barInfo = analyzeScheduleBar(bar, targetRgbs, maxDist, opacityGate);
            if (!barInfo.passesOpacity || !barInfo.passesColor) {
                continue;
            }
            stats.barColorPass++;
            var puckLeg = leg.querySelector(PUCK_QE);
            var arr = arrivalStationFromPuck(puckLeg);
            var dep = departureStationFromPuck(puckLeg);
            if (!arr || arr !== station) {
                continue;
            }
            stats.arrMatchStation++;
            /** Inbound to map station only — exclude outbound from hub (e.g. DAL→DEN). */
            if (dep && dep === station) {
                stats.skippedOutboundSameStation++;
                continue;
            }
            n++;
            if (debugMatch) {
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
        return { count: n, stats: stats };
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

    function removeFloatingHud() {
        try {
            var fh = document.querySelector('[' + FLOAT_HOST_ATTR + '="1"]');
            if (fh) {
                fh.remove();
            }
        } catch (e) {}
    }

    /**
     * Fixed overlay when “A/C ON THE GROUND” row is missing so count + tick logs still run.
     */
    function ensureFloatingHud(cnt, stationCode, stats) {
        var host = document.querySelector('[' + FLOAT_HOST_ATTR + '="1"]');
        if (!host) {
            host = document.createElement('div');
            host.setAttribute(FLOAT_HOST_ATTR, '1');
            host.style.cssText =
                'position:fixed;top:12px;right:12px;z-index:2147483646;' +
                'font:12px/1.35 system-ui,-apple-system,sans-serif;' +
                'background:rgba(15,23,42,.94);color:#e2e8f0;padding:10px 14px;' +
                'border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.4);' +
                'pointer-events:none;max-width:min(420px,calc(100vw - 24px));';
            try {
                document.documentElement.appendChild(host);
            } catch (e2) {
                try {
                    document.body.appendChild(host);
                } catch (e3) {}
            }
        }
        var line1 =
            '<strong style="color:#93c5fd">AC enroute</strong>: ' +
            String(cnt) +
            (stationCode ? ' · <span style="opacity:.85">' + escapeHtml(stationCode) + '</span>' : '');
        var line2 =
            stats &&
            '<span style="opacity:.75;font-size:11px">' +
            'legs ' +
            stats.legCount +
            ' · bars ' +
            stats.barsFound +
            ' · color✓ ' +
            stats.barColorPass +
            ' · arr=' +
            stationCode +
            ': ' +
            stats.arrMatchStation +
            '</span>';
        var hint =
            !stationCode
                ? '<div style="margin-top:6px;font-size:11px;opacity:.85">No station from dropdown — pick STATION on the map.</div>'
                : stats && stats.legCount === 0
                  ? '<div style="margin-top:6px;font-size:11px;opacity:.85">No flight legs in DOM — scroll/zoom map or wait for load.</div>'
                  : '';
        host.innerHTML =
            '<div>' +
            line1 +
            '</div>' +
            (line2 ? '<div style="margin-top:4px">' + line2 + '</div>' : '') +
            hint +
            '<div style="margin-top:6px;font-size:10px;opacity:.55">HUD: stats row not found</div>';
    }

    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ensureEnrouteRow() {
        var existing = document.querySelector('[' + HOST_ROW_ATTR + '="1"]');
        var groundRow = findGroundStatRow();

        var st = readSelectedStationCode();
        if (!st) {
            if (existing) {
                try {
                    existing.remove();
                } catch (e) {}
            }
            removeFloatingHud();
            return;
        }
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
        var dbgMatch = boolPref('acEnrouteDebugMatchLog', true);
        var dbgTick = boolPref('acEnrouteDebugTickLog', true);

        var scanned = scanEnrouteToStation(st, rgbs, tol, opacityGate, dbgMatch);
        var cnt = scanned.count;
        var stats = scanned.stats;

        var now = Date.now();
        if (dbgTick && now - tickLogLastMs >= TICK_LOG_MS) {
            tickLogLastMs = now;
            try {
                console.log('[AC enroute] tick', {
                    station: st || '(empty)',
                    count: cnt,
                    groundRowFound: !!groundRow,
                    legs: stats.legCount,
                    barsInLegs: stats.barsFound,
                    barColorPass: stats.barColorPass,
                    arrEqualsStation: stats.arrMatchStation,
                    tol: tol,
                    excludeOpacity: exLow
                });
            } catch (e0) {}
        }

        if (!groundRow || !groundRow.parentNode) {
            if (existing) {
                try {
                    existing.remove();
                } catch (e) {}
            }
            ensureFloatingHud(cnt, st, stats);
            return;
        }

        removeFloatingHud();

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
            removeFloatingHud();
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
        removeFloatingHud();
        tickLogLastMs = 0;
        window.__myScriptCleanup = undefined;
    };
})();
