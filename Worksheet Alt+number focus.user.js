// ==UserScript==
// @name         Worksheet Alt+number focus
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  Alt+1..9 = focus worksheet 1..9, Alt+0 = worksheet 10. Matches tab title (WS #, Worksheet renamer, etc.); uses same broadcast channel as Pax late → worksheet.
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"wsAltNumJumperEnabled":{"type":"boolean","group":"Worksheet hotkey","label":"Enable Alt+number","default":true,"description":"Alt+1..9 focus WS 1..9, Alt+0 = WS 10. Best-effort: browser may not switch tabs; matching worksheet still runs window.focus() and a title flash if hidden."},"wsAltNumJumperLog":{"type":"boolean","group":"Worksheet hotkey","label":"Debug log","default":false,"description":"Console: which worksheet matched, focus attempts."}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20Alt%2Bnumber%20focus.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20Alt%2Bnumber%20focus.user.js
// ==/UserScript==

(function () {
    'use strict';

    var BC_NAME = 'dc_pax_late_to_ws_v1';
    var MSG_T = 'ws_focus_by_num';

    var ch = null;
    var onKey = null;
    var onBcast = null;
    var initTimer = null;

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

    function log() {
        if (getPref('wsAltNumJumperLog', false) === false) {
            return;
        }
        try {
            console.log.apply(
                console,
                ['%c[WS-ALT#]', 'color:#9b59b6'].concat(
                    [].slice.call(arguments)
                )
            );
        } catch (e) {}
    }

    function isWorksheetPath() {
        try {
            return (
                String(location.pathname || '').indexOf('/widgets/worksheet') ===
                0
            );
        } catch (e) {
            return false;
        }
    }

    /**
     * Best-effort: same idea as Worksheet renamer — get the canonical # from the tab title.
     */
    function extractWorksheetNumberFromTitle(t) {
        var s = String(t || '');
        var m = s.match(/WorkSheet\s*#?\s*(\d{1,4})/i);
        if (m) {
            return m[1];
        }
        m = s.match(/(\d{1,4})\s*[-–:#]?\s*WorkSheet/i);
        if (m) {
            return m[1];
        }
        m = s.match(/^\s*WS\s*#?\s*(\d{1,4})\s*$/i);
        if (m) {
            return m[1];
        }
        m = s.match(/\bWS\s*#?\s*(\d{1,4})\b/i);
        if (m) {
            return m[1];
        }
        m = s.match(/^\s*(\d{1,4})\s*[·•]\s*/);
        if (m) {
            return m[1];
        }
        return '';
    }

    function tryFocusThisWorksheetIfNumberMatches(wantNum) {
        if (!isWorksheetPath()) {
            return;
        }
        var w = String(wantNum);
        var got = extractWorksheetNumberFromTitle(document.title);
        if (!got || got !== w) {
            return;
        }
        log('Match WS ' + w + ' — focus this tab');
        try {
            window.focus();
        } catch (e) {}
        try {
            if (document.hidden) {
                var o = document.title;
                var step = 0;
                var iv = setInterval(function () {
                    document.title = step % 2 ? o : '► ' + o;
                    step++;
                    if (step > 5) {
                        clearInterval(iv);
                        document.title = o;
                    }
                }, 200);
            }
        } catch (e2) {}
    }

    function onBroadcastMessage(ev) {
        var d = ev && ev.data;
        if (!d || d.t !== MSG_T) {
            return;
        }
        if (d.n == null) {
            return;
        }
        tryFocusThisWorksheetIfNumberMatches(d.n);
    }

    function ensureChannel() {
        if (ch) {
            return ch;
        }
        if (typeof BroadcastChannel === 'undefined') {
            return null;
        }
        try {
            ch = new BroadcastChannel(BC_NAME);
            ch.addEventListener('message', onBcast);
        } catch (e) {
            ch = null;
        }
        return ch;
    }

    function postFocusRequest(num) {
        var c = ensureChannel();
        if (!c) {
            log('BroadcastChannel unavailable');
            return;
        }
        try {
            c.postMessage({
                t: MSG_T,
                n: num,
                ts: Date.now()
            });
        } catch (e) {}
    }

    function keyToWorksheetNumber(e) {
        if (!e) {
            return null;
        }
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            return null;
        }
        if (!e.altKey) {
            return null;
        }
        var c = e.code || '';
        if (c === 'Digit0' || c === 'Numpad0') {
            return 10;
        }
        var m = /^Digit([1-9])$/.exec(c) || /^Numpad([1-9])$/.exec(c);
        if (m) {
            return parseInt(m[1], 10);
        }
        var k = e.key;
        if (k === '0') {
            return 10;
        }
        if (k.length === 1 && k >= '1' && k <= '9') {
            return parseInt(k, 10);
        }
        return null;
    }

    function onKeyDown(e) {
        if (getPref('wsAltNumJumperEnabled', true) === false) {
            return;
        }
        var n = keyToWorksheetNumber(e);
        if (n == null) {
            return;
        }
        if (e.defaultPrevented) {
            return;
        }
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (e2) {}
        postFocusRequest(n);
        if (isWorksheetPath()) {
            setTimeout(function () {
                tryFocusThisWorksheetIfNumberMatches(n);
            }, 0);
        }
    }

    function init() {
        onBcast = onBroadcastMessage;
        onKey = onKeyDown;
        ensureChannel();
        document.addEventListener('keydown', onKey, true);
    }

    initTimer = setTimeout(init, 400);

    window.__myScriptCleanup = function () {
        if (initTimer) {
            clearTimeout(initTimer);
            initTimer = null;
        }
        if (onKey) {
            try {
                document.removeEventListener('keydown', onKey, true);
            } catch (e) {}
            onKey = null;
        }
        if (ch) {
            try {
                ch.removeEventListener('message', onBcast);
                ch.close();
            } catch (e) {}
            ch = null;
        }
        onBcast = null;
    };
})();
