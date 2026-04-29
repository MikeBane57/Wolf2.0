// ==UserScript==
// @name         AC enroute count (schedule)
// @namespace    Wolf 2.0
// @version      1.0.3
// @description  Arr station from puck cell (tg9Iiv9oAOo + Ziu3-r4LY1M); active bar colors #3390ef / #abcdf8.
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @donkeycode-pref {"acEnrouteEnabled":{"type":"boolean","group":"AC enroute","label":"Show enroute count","description":"When ON, insert AC enroute next to A/C ON THE GROUND and refresh as legs change.","default":true},"acEnrouteActiveBarColors":{"type":"string","group":"AC enroute","label":"Active leg bar colors (hex)","description":"Comma-separated #RGB hex values for the schedule bar when the flight is still active/enroute. Default matches ops map blues.","default":"#3390ef,#abcdf8","placeholder":"#3390ef,#abcdf8"}}
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
    /** Arrival airport cell: same base as dep but paired with this class token */
    var ARR_STATION_EXTRA_SUBSEL = '[class*="Ziu3-r4LY1M="]';
    var STATION_COMBO = 'div[name="station"][role="combobox"]';

    var mo = null;
    var debounceTimer = null;
    var groundMo = null;

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

    function parseEnrouteBarColors() {
        var raw = String(getPref('acEnrouteActiveBarColors', '#3390ef,#abcdf8') || '');
        var parts = raw.split(',');
        var set = Object.create(null);
        var i;
        for (i = 0; i < parts.length; i++) {
            var h = String(parts[i] || '')
                .trim()
                .toLowerCase();
            if (/^#[0-9a-f]{6}$/.test(h)) {
                set[h] = true;
            }
        }
        if (!Object.keys(set).length) {
            set['#3390ef'] = true;
            set['#abcdf8'] = true;
        }
        return set;
    }

    function cssColorToHex(cssVal) {
        if (!cssVal || typeof cssVal !== 'string') {
            return '';
        }
        var s = cssVal.trim();
        if (/^#[0-9a-f]{6}$/i.test(s)) {
            return s.toLowerCase();
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

    function barMatchesActiveEnrouteColors(barEl, allowedHex) {
        if (!barEl) {
            return false;
        }
        var hex = '';
        try {
            hex = cssColorToHex(window.getComputedStyle(barEl).backgroundColor);
        } catch (e) {}
        if (!hex) {
            try {
                hex = cssColorToHex(barEl.style && barEl.style.backgroundColor);
            } catch (e2) {}
        }
        return !!(hex && allowedHex[hex]);
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

    function countEnrouteToStation(station, allowedHex) {
        if (!station) {
            return 0;
        }
        var legs = document.querySelectorAll(LEG_QE);
        var n = 0;
        var li;
        for (li = 0; li < legs.length; li++) {
            var leg = legs[li];
            var bar = leg.querySelector(SCHED_BAR_SEL);
            if (!barMatchesActiveEnrouteColors(bar, allowedHex)) {
                continue;
            }
            var puckLeg = leg.querySelector(PUCK_QE);
            var arr = arrivalStationFromPuck(puckLeg);
            if (arr && arr === station) {
                n++;
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
        var colors = parseEnrouteBarColors();
        var cnt = countEnrouteToStation(st, colors);
        valEl.textContent = String(cnt);
        valEl.title =
            st
                ? 'Flights enroute to ' + st + ' (leg bar color matches active blues)'
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

    function init() {
        if (!boolPref('acEnrouteEnabled', true)) {
            return;
        }
        scheduleUpdate();
        watchGroundArea();
        mo = new MutationObserver(function () {
            scheduleUpdate();
            watchGroundArea();
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
        try {
            var r = document.querySelector('[' + HOST_ROW_ATTR + '="1"]');
            if (r) {
                r.remove();
            }
        } catch (e3) {}
        window.__myScriptCleanup = undefined;
    };
})();
