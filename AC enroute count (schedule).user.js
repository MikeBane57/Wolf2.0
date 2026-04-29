// ==UserScript==
// @name         AC enroute count (schedule)
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  Ops map: count flights enroute to the selected station (non-faded legs); show next to A/C ON THE GROUND.
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @donkeycode-pref {"acEnrouteEnabled":{"type":"boolean","group":"AC enroute","label":"Show enroute count","description":"When ON, insert AC enroute next to A/C ON THE GROUND and refresh as legs change.","default":true},"acEnrouteCompletedOpacityMax":{"type":"number","group":"AC enroute","label":"Treat as completed if bar opacity ≤","description":"Matches Completed flight opacity script (default 0.4). Legs at or below this opacity are not counted as enroute.","default":0.45,"min":0,"max":1,"step":0.05}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20enroute%20count%20(schedule).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20enroute%20count%20(schedule).user.js
// ==/UserScript==

(function () {
    'use strict';

    var HOST_ROW_ATTR = 'data-dc-ac-enroute-row';
    var LABEL_TEXT = 'AC enroute';
    var LEG_QE = '[data-qe-id="as-flight-leg"]';
    var PUCK_QE = '[data-qe-id="as-flight-leg-puck"]';
    /** Same obfuscated class as Completed flight opacity.user.js — schedule bar behind completed legs */
    var SCHED_BAR_SEL = '.vVzbj3J5m70\\=';
    /** Station code cells on puck (dep / arr), same pattern as Pax late script */
    var STATION_CELL_SUBSEL = '[class*="tg9Iiv9oAOo="]';
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

    function numPref(key, def, lo, hi) {
        var n = Number(getPref(key, def));
        if (!Number.isFinite(n)) {
            return def;
        }
        return Math.min(hi, Math.max(lo, n));
    }

    function readSelectedStationCode() {
        var combo = document.querySelector(STATION_COMBO);
        if (!combo) {
            return '';
        }
        var div = combo.querySelector('.divider.text');
        if (div) {
            var t = String(div.textContent || '').trim();
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

    function barLooksCompleted(barEl, threshold) {
        if (!barEl) {
            return false;
        }
        var op = 1;
        try {
            op = parseFloat(window.getComputedStyle(barEl).opacity);
        } catch (e) {
            try {
                var inline = barEl.style && barEl.style.opacity;
                if (inline) {
                    op = parseFloat(inline);
                }
            } catch (e2) {}
        }
        if (!Number.isFinite(op)) {
            op = 1;
        }
        return op <= threshold;
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

    function countEnrouteToStation(station, completedOpacityMax) {
        if (!station) {
            return 0;
        }
        var legs = document.querySelectorAll(LEG_QE);
        var n = 0;
        var li;
        for (li = 0; li < legs.length; li++) {
            var leg = legs[li];
            var bar = leg.querySelector(SCHED_BAR_SEL);
            if (barLooksCompleted(bar, completedOpacityMax)) {
                continue;
            }
            var puck = leg.querySelector(PUCK_QE);
            var ap = airportsFromPuck(puck);
            var arr = ap.length >= 2 ? ap[1] : '';
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
        var maxOp = numPref('acEnrouteCompletedOpacityMax', 0.45, 0, 1);
        var cnt = countEnrouteToStation(st, maxOp);
        valEl.textContent = String(cnt);
        valEl.title =
            st ? 'Flights enroute to ' + st + ' (non-completed legs on map)' : 'Select a station to count enroute flights';
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
