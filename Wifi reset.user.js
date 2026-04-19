// ==UserScript==
// @name         Wifi reset
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  Double-click an area showing an aircraft registration (e.g. N1802U) to open mail to Anuvu for a wifi reset request
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"wifiResetEmailTo":{"type":"string","group":"Wifi reset email","label":"To","description":"Full recipient address (include LOM> prefix if your mail uses it).","default":"LOM>NOC@anuvu.com","placeholder":"LOM>NOC@anuvu.com"},"wifiResetSubjectTemplate":{"type":"string","group":"Wifi reset email","label":"Subject template","description":"{tail} = registration from the double-clicked area (e.g. N1802U).","default":"Jet {tail} Wifi Reset","placeholder":"Jet {tail} Wifi Reset"},"wifiResetBodyTemplate":{"type":"string","group":"Wifi reset email","label":"Body template","description":"{tail} = aircraft registration. Line breaks are preserved.","default":"Hello Anuvu,\n\nPlease reset aircraft {tail}.\n\nThanks,\nDispatch, NOC\nSouthwest Airlines"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Wifi%20reset.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Wifi%20reset.user.js
// ==/UserScript==

(function() {
    'use strict';

    var TAIL_RE = /\b(N[0-9A-Z]{4,6})\b/g;

    var onDblClickCapture = null;

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

    /**
     * Walk from the double-click target up; use the first N-number found in each node's text.
     */
    function findTailFromEventTarget(target) {
        if (!target || target.nodeType !== 1) {
            return null;
        }
        var el = target;
        var hop;
        for (hop = 0; hop < 14 && el; hop++) {
            var text = el.textContent || '';
            TAIL_RE.lastIndex = 0;
            var m = TAIL_RE.exec(text);
            if (m && m[1]) {
                return String(m[1]).toUpperCase();
            }
            el = el.parentElement;
        }
        return null;
    }

    function applyTemplate(tpl, tail) {
        return String(tpl || '')
            .split('{tail}').join(tail)
            .replace(/\r\n/g, '\n');
    }

    function openMailtoForTail(tail) {
        var to = String(getPref('wifiResetEmailTo', 'LOM>NOC@anuvu.com') || 'LOM>NOC@anuvu.com').trim();
        var subject = applyTemplate(
            getPref('wifiResetSubjectTemplate', 'Jet {tail} Wifi Reset'),
            tail
        );
        var body = applyTemplate(
            getPref('wifiResetBodyTemplate', 'Hello Anuvu,\n\nPlease reset aircraft {tail}.\n\nThanks,\nDispatch, NOC\nSouthwest Airlines'),
            tail
        );
        var href =
            'mailto:' +
            encodeURIComponent(to) +
            '?subject=' +
            encodeURIComponent(subject) +
            '&body=' +
            encodeURIComponent(body);
        var a = document.createElement('a');
        a.href = href;
        a.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function init() {
        onDblClickCapture = function(e) {
            if (e.button !== 0) {
                return;
            }
            var tail = findTailFromEventTarget(e.target);
            if (!tail) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openMailtoForTail(tail);
        };
        document.addEventListener('dblclick', onDblClickCapture, true);
    }

    init();

    window.__myScriptCleanup = function() {
        if (onDblClickCapture) {
            document.removeEventListener('dblclick', onDblClickCapture, true);
            onDblClickCapture = null;
        }
        window.__myScriptCleanup = undefined;
    };
})();
