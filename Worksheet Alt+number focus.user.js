// ==UserScript==
// @name         Worksheet Alt+number focus
// @namespace    Wolf 2.0
// @version      1.1.0
// @description  Alt+1..9 / Alt+0 (10): BroadcastChannel + localStorage for cross-tab focus. Bare title "1" matches. Browsers may block raising tab to front.
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"wsAltNumJumperEnabled":{"type":"boolean","group":"Worksheet hotkey","label":"Enable Alt+number","default":true,"description":"Alt+1..9 and Alt+0 = worksheet 10. Uses BroadcastChannel plus localStorage so other tabs get the request when yours is not focused. Chromium often blocks programmatic tab activation; title will still flash if a match. For a true top tab, use Ctrl+Tab, the window’s own hotkeys, or reorder and use Chrome/Edge Alt+1-8."},"wsAltNumJumperLog":{"type":"boolean","group":"Worksheet hotkey","label":"Debug log","default":false,"description":"Console: which # was requested, what the page title parsed to, and if a match fired focus."}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20Alt%2Bnumber%20focus.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Worksheet%20Alt%2Bnumber%20focus.user.js
// ==/UserScript==

(function () {
    'use strict';

    var BC_NAME = 'dc_pax_late_to_ws_v1';
    var MSG_T = 'ws_focus_by_num';
    /** Same-origin; storage event is delivered to *other* tabs and often more reliable than broadcast for focus. */
    var LS_FOCUS_KEY = 'dc_ws_alt_focus_v1';

    var ch = null;
    var onKey = null;
    var onBcast = null;
    var onStorage = null;
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
     * Includes bare "1" or "12" (renamed tab is only the index).
     */
    function extractWorksheetNumberFromTitle(t) {
        var s = String(t || '').trim();
        if (!s) {
            return '';
        }
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
        m = s.match(/^\s*(\d{1,4})\s*[·•]/);
        if (m) {
            return m[1];
        }
        m = /^\s*(\d{1,4})\s*$/.exec(s);
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
            if (getPref('wsAltNumJumperLog', false) !== false) {
                log('No match: want ' + w + ', title parsed as "' + got + '" (raw title: ' + (document.title || '').slice(0, 80) + ')');
            }
            return;
        }
        log('Match WS ' + w + ' — focus (hidden=' + !!document.hidden + ')');
        function doFocus() {
            try {
                if (document.body && document.body.focus) {
                    document.body.focus();
                }
            } catch (e0) {}
            try {
                window.focus();
            } catch (e) {}
        }
        doFocus();
        setTimeout(doFocus, 0);
        setTimeout(doFocus, 50);
        try {
            var o = document.title;
            if (o) {
                var step = 0;
                var iv = setInterval(function () {
                    document.title = step % 2 ? o : '► ' + o;
                    step++;
                    if (step > 5) {
                        try {
                            clearInterval(iv);
                        } catch (e) {}
                        document.title = o;
                    }
                }, 220);
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
        } else {
            try {
                c.postMessage({
                    t: MSG_T,
                    n: num,
                    ts: Date.now()
                });
            } catch (e) {}
        }
        try {
            localStorage.setItem(
                LS_FOCUS_KEY,
                JSON.stringify({
                    t: MSG_T,
                    n: num,
                    ts: Date.now(),
                    r: String(Math.random()).slice(2, 12)
                })
            );
        } catch (e) {
            log('localStorage focus ping failed (private mode?)');
        }
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

    function onStorageEvent(ev) {
        if (!ev || ev.key !== LS_FOCUS_KEY || !ev.newValue) {
            return;
        }
        var d;
        try {
            d = JSON.parse(ev.newValue);
        } catch (e) {
            return;
        }
        if (!d || d.t !== MSG_T || d.n == null) {
            return;
        }
        tryFocusThisWorksheetIfNumberMatches(d.n);
    }

    function init() {
        onBcast = onBroadcastMessage;
        onStorage = onStorageEvent;
        onKey = onKeyDown;
        ensureChannel();
        try {
            window.addEventListener('storage', onStorage, false);
        } catch (e) {}
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
        if (onStorage) {
            try {
                window.removeEventListener('storage', onStorage, false);
            } catch (e) {}
            onStorage = null;
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
