// ==UserScript==
// @name         Send AC to WS (send late FLT required)
// @namespace    Wolf 2.0
// @version      1.1.3
// @description  Right-click AC: send tail to another worksheet. Requires Send late flights to WS Pax Conx on worksheet tabs (BroadcastChannel ws_apply_tail).
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        none
// @donkeycode-pref {"acTailToWsEnabled":{"type":"boolean","group":"AC → worksheet","label":"Enable context menu","default":true},"acTailToWsListWaitMs":{"type":"number","group":"AC → worksheet","label":"Worksheet list wait (ms)","default":2000,"min":100,"max":8000,"step":100,"description":"How long to wait for worksheet tabs to answer ws_list (raise if the list is often empty)."},"acTailToWsLog":{"type":"boolean","group":"AC → worksheet","label":"Debug log","default":false}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20context%20menu%20-%20send%20tail%20to%20worksheet.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20context%20menu%20-%20send%20tail%20to%20worksheet.user.js
// ==/UserScript==

(function () {
    'use strict';

    var BC_WS_NAME = 'dc_pax_late_to_ws_v1';
    /** Same key as Send late flights to WS Pax Conx — per-tab worksheet identity. */
    var WS_TAB_ID_KEY = 'dcPaxLateWsTabId';

    var ch = null;
    var menuObserver = null;
    var lastContextTarget = null;
    var lastExtractedTail = '';
    var initTimer = null;
    var onCtx = null;

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
        if (getPref('acTailToWsLog', false) === false) {
            return;
        }
        try {
            console.log.apply(
                console,
                ['%c[AC→WS]', 'color:#1abc9c'].concat(
                    [].slice.call(arguments)
                )
            );
        } catch (e) {}
    }

    function randomBcastId() {
        return String(Date.now()) + '-' + String(Math.random()).slice(2, 11);
    }

    function ensureChannel() {
        if (ch) {
            return ch;
        }
        if (typeof BroadcastChannel === 'undefined') {
            return null;
        }
        try {
            ch = new BroadcastChannel(BC_WS_NAME);
        } catch (e) {
            ch = null;
        }
        return ch;
    }

    function listWaitMs() {
        var n = Number(getPref('acTailToWsListWaitMs', 2000));
        if (!Number.isFinite(n)) {
            return 2000;
        }
        return Math.min(8000, Math.max(100, Math.floor(n)));
    }

    function listWorksheetTabsOnce() {
        return new Promise(function (resolve) {
            var c = ensureChannel();
            if (!c) {
                resolve([]);
                return;
            }
            var listId = randomBcastId();
            var seen = Object.create(null);
            var did = false;
            function finish() {
                if (did) {
                    return;
                }
                did = true;
                try {
                    c.removeEventListener('message', onMsg);
                } catch (e) {}
                try {
                    clearTimeout(to);
                } catch (e2) {}
                var out = [];
                var k;
                for (k in seen) {
                    if (Object.prototype.hasOwnProperty.call(seen, k)) {
                        out.push(seen[k]);
                    }
                }
                out.sort(function (a, b) {
                    return String(a.title).localeCompare(String(b.title));
                });
                resolve(out);
            }
            function onMsg(ev) {
                var d = ev && ev.data;
                if (!d || d.t !== 'ws_hello' || d.listId !== listId) {
                    return;
                }
                if (d.tabId) {
                    seen[d.tabId] = { tabId: d.tabId, title: d.title || d.tabId };
                }
            }
            c.addEventListener('message', onMsg);
            var to = setTimeout(finish, listWaitMs());
            try {
                c.postMessage({ t: 'ws_list', listId: listId });
            } catch (e) {
                finish();
            }
        });
    }

    function listWorksheetTabs() {
        return listWorksheetTabsOnce().then(function (first) {
            if (first && first.length) {
                return first;
            }
            return new Promise(function (r) {
                setTimeout(function () {
                    listWorksheetTabsOnce().then(r);
                }, 400);
            });
        });
    }

    var worksheetTabIdLocal = '';

    /**
     * Tab id for this worksheet (must match Pax script's getOrCreateWorksheetTabId).
     */
    function getOrCreateWorksheetTabIdForThisPage() {
        if (worksheetTabIdLocal) {
            return worksheetTabIdLocal;
        }
        try {
            var ex = sessionStorage.getItem(WS_TAB_ID_KEY);
            if (ex) {
                worksheetTabIdLocal = ex;
                return ex;
            }
        } catch (e) {}
        worksheetTabIdLocal =
            'ws' +
            String(Date.now()) +
            '-' +
            String(Math.random()).slice(2, 10);
        try {
            sessionStorage.setItem(WS_TAB_ID_KEY, worksheetTabIdLocal);
        } catch (e2) {}
        return worksheetTabIdLocal;
    }

    function postApplyTailToWorksheet(tail, targetTabId) {
        var c = ensureChannel();
        if (!c) {
            log('postApplyTail: no BroadcastChannel');
            return;
        }
        var id = randomBcastId();
        var payload = {
            t: 'ws_apply_tail',
            id: id,
            tail: String(tail || '').trim().toUpperCase(),
            targetTabId: targetTabId
        };
        var k;
        for (k = 0; k < 4; k++) {
            try {
                c.postMessage(payload);
            } catch (e) {}
        }
        log('ws_apply_tail burst id=' + id + ' tail=' + payload.tail);
    }

    var RE_N_NUMBER = /N\d{1,5}[A-Z]?/i;
    /** Alternate AC row layout (worksheet) — see XrjX-V8q874 block vs AoJn2gDrLWo. */
    var RE_TAIL_ALTERNATE = /\b([A-Z]{1,2}\d{1,5}[A-Z]{0,2})\b/;
    /** Fleet / line id when not N-number (e.g. 7S7). */
    var RE_LINE_ID = /^[A-Z0-9]{2,7}$/i;

    function textOneLine(el) {
        if (!el) {
            return '';
        }
        return String(el.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function tailFromPlainLine(s) {
        if (!s) {
            return '';
        }
        s = String(s).replace(/\s+/g, ' ').trim();
        if (s.length < 2 || s.length > 35) {
            return '';
        }
        if (/^[A-Z]{3}$/i.test(s)) {
            return '';
        }
        if (s.indexOf('#') === 0) {
            return '';
        }
        var m = s.match(RE_N_NUMBER);
        if (m) {
            return m[0].toUpperCase();
        }
        m = s.match(RE_TAIL_ALTERNATE);
        if (m) {
            return m[1].toUpperCase();
        }
        if (RE_LINE_ID.test(s) && !/^\d+$/.test(s)) {
            return s.toUpperCase();
        }
        return '';
    }

    function extractTailFromAcBlock(root) {
        if (!root || !root.querySelector) {
            return '';
        }
        var tryEls = [];
        var sels = [
            'div[class*="opUU"]',
            'div[class*="o8Cnb"]',
            'div[class*="AId8"]'
        ];
        var q;
        for (q = 0; q < sels.length; q++) {
            var n = root.querySelector(sels[q]);
            if (n) {
                tryEls.push(n);
            }
        }
        for (q = 0; q < tryEls.length; q++) {
            var t0 = tailFromPlainLine(textOneLine(tryEls[q]));
            if (t0) {
                return t0;
            }
        }
        var cand = tryEls[0] || null;
        var t = '';
        if (cand) {
            t = textOneLine(cand);
        }
        if (!t) {
            t = textOneLine(root);
        }
        if (!t) {
            return '';
        }
        var m = t.match(RE_N_NUMBER);
        if (m) {
            return m[0].toUpperCase();
        }
        m = t.match(RE_TAIL_ALTERNATE);
        if (m) {
            return m[1].toUpperCase();
        }
        // Obfuscated layout: scan child divs for a lone id / tail line
        var kids = root.querySelectorAll('div');
        var i;
        for (i = 0; i < kids.length; i++) {
            var t1 = tailFromPlainLine(textOneLine(kids[i]));
            if (t1) {
                return t1;
            }
        }
        t = textOneLine(root);
        m = t.match(RE_N_NUMBER);
        if (m) {
            return m[0].toUpperCase();
        }
        m = t.match(RE_TAIL_ALTERNATE);
        if (m) {
            return m[1].toUpperCase();
        }
        return tailFromPlainLine(t);
    }

    function isLikelyAcContextMenuPopup(popup) {
        if (!popup || !popup.querySelector) {
            return false;
        }
        if (!popup.classList) {
            return false;
        }
        var c = (popup.getAttribute('class') || '') + ' ';
        if (c.indexOf('popup') < 0) {
            return false;
        }
        var menu = popup.querySelector('.ui.vertical.menu, [class*="menu"]');
        if (!menu) {
            return false;
        }
        var a = menu.querySelector('a.item');
        var t = a ? a.textContent || '' : '';
        t = t.replace(/\s+/g, ' ').toLowerCase();
        return t.indexOf('aircraft') >= 0;
    }

    function wireSendTailMenu(popup) {
        if (popup.getAttribute('data-dc-ac-tail-ws-wired') === '1') {
            return;
        }
        var menu = popup.querySelector('div.ui.vertical.menu');
        if (!menu) {
            menu = popup.querySelector('div[class*="Bw0ugF5aVzw"]');
        }
        if (!menu) {
            menu = popup.querySelector('div[class*="menu"]');
        }
        if (!menu) {
            return;
        }
        var firstItem = menu.querySelector('a');
        if (!firstItem) {
            return;
        }
        if (!String(lastExtractedTail || '').trim()) {
            if (getPref('acTailToWsLog', false) !== false) {
                log('No tail parsed from AC block, skip menu');
            }
            return;
        }
        popup.setAttribute('data-dc-ac-tail-ws-wired', '1');

        var wrap = document.createElement('div');
        wrap.style.cssText =
            'position:relative!important;display:block!important;';

        var trigger = document.createElement('a');
        trigger.setAttribute('role', 'menuitem');
        trigger.className = firstItem.className || 'item';
        trigger.href = '#';
        trigger.textContent = 'Send tail to worksheet';
        if (getComputedStyle(trigger).cursor === 'auto') {
            trigger.style.cursor = 'pointer';
        }

        var sub = document.createElement('div');
        sub.setAttribute('data-dc-ac-tail-ws-sub', '1');
        sub.className =
            (menu.getAttribute('class') || 'ui vertical menu') +
            ' dc-ac-tail-ws-flyout';
        sub.style.cssText =
            'display:none!important;position:absolute!important;left:100%!important;top:0!important;margin-left:2px!important;' +
            'min-width:220px!important;z-index:10000!important;max-height:50vh!important;overflow-y:auto!important;';
        var loading = document.createElement('a');
        loading.className = firstItem.className || 'item';
        loading.href = '#';
        loading.textContent = 'Loading worksheets…';
        loading.style.cssText = 'pointer-events:none!important;opacity:.7!important;';
        sub.appendChild(loading);

        wrap.appendChild(trigger);
        wrap.appendChild(sub);

        var listLoaded = false;
        var hideTid = null;
        function showSub() {
            if (hideTid) {
                clearTimeout(hideTid);
                hideTid = null;
            }
            sub.style.setProperty('display', 'block', 'important');
        }
        function scheduleHide() {
            if (hideTid) {
                clearTimeout(hideTid);
            }
            hideTid = setTimeout(function () {
                sub.style.setProperty('display', 'none', 'important');
            }, 220);
        }
        function loadAndFillSub() {
            if (listLoaded) {
                return;
            }
            listLoaded = true;
            listWorksheetTabs().then(function (tabs) {
                if (!sub.parentNode) {
                    return;
                }
                sub.innerHTML = '';
                var myId = getOrCreateWorksheetTabIdForThisPage();
                var hadAny = tabs && tabs.length > 0;
                if (tabs && tabs.length && myId) {
                    tabs = tabs.filter(function (x) {
                        return x && String(x.tabId) !== String(myId);
                    });
                }
                if (!tabs || !tabs.length) {
                    var d0 = document.createElement('a');
                    d0.className = firstItem.className || 'item';
                    d0.href = '#';
                    d0.textContent = hadAny
                        ? 'No other worksheets — you are on the only target, or open another worksheet tab with "Send late flights to WS Pax Conx" (v1.9.9+).'
                        : 'No worksheets found — open a worksheet with "Send late flights to WS Pax Conx" (v1.9.9+).';
                    d0.style.cssText = 'color:#e67e22!important;white-space:normal!important;';
                    sub.appendChild(d0);
                    return;
                }
                var h = document.createElement('a');
                h.className = firstItem.className || 'item';
                h.href = '#';
                h.textContent = 'AC: ' + String(lastExtractedTail);
                h.style.cssText = 'pointer-events:none!important;opacity:.85!important;font-size:.9em!important;';
                sub.appendChild(h);
                var j;
                for (j = 0; j < tabs.length; j++) {
                    (function (tab) {
                        var row = document.createElement('a');
                        row.className = firstItem.className || 'item';
                        row.href = '#';
                        row.textContent = tab.title || tab.tabId;
                        function sendEv(e) {
                            if (e) {
                                e.preventDefault();
                                e.stopPropagation();
                            }
                            setTimeout(function () {
                                postApplyTailToWorksheet(
                                    lastExtractedTail,
                                    tab.tabId
                                );
                            }, 0);
                            log('Sent ' + lastExtractedTail + ' → ' + (tab.title || tab.tabId));
                        }
                        row.addEventListener('mousedown', function (e) {
                            e.preventDefault();
                            e.stopPropagation();
                            sendEv(e);
                        }, true);
                        row.addEventListener('click', sendEv, true);
                        sub.appendChild(row);
                    })(tabs[j]);
                }
            });
        }
        trigger.addEventListener('mouseenter', function () {
            showSub();
            loadAndFillSub();
        });
        trigger.addEventListener('mouseleave', scheduleHide);
        sub.addEventListener('mouseenter', showSub);
        sub.addEventListener('mouseleave', scheduleHide);

        try {
            menu.appendChild(wrap);
        } catch (e) {
            try {
                menu.appendChild(wrap);
            } catch (e2) {}
        }
    }

    function scanForMenu() {
        var list = document.querySelectorAll(
            'div.ui.popup, div[class*="popup"]'
        );
        var i;
        for (i = 0; i < list.length; i++) {
            var p = list[i];
            if (!p.querySelector) {
                continue;
            }
            if (!/visible/.test(p.getAttribute('class') || '')) {
                continue;
            }
            if (isLikelyAcContextMenuPopup(p)) {
                wireSendTailMenu(p);
            }
        }
    }

    function onContextMenu(e) {
        if (getPref('acTailToWsEnabled', true) === false) {
            return;
        }
        var t = e.target;
        if (!t) {
            return;
        }
        var el = t.nodeType === 1 ? t : t.parentElement;
        if (!el) {
            return;
        }
        var hasType = el.closest
            ? el.closest('[data-testid="iata-display-type"]')
            : null;
        var inBlock =
            (el.closest &&
                el.closest(
                    'div.AoJn2gDrLWo, [class*="AoJn2gDrLWo"], [class*="XrjX-V8q874"], [class*="XrjX"]'
                )) ||
            null;
        if (inBlock) {
            lastContextTarget = inBlock;
        } else if (hasType) {
            lastContextTarget = hasType.closest('div') || hasType;
        } else {
            return;
        }
        lastExtractedTail = extractTailFromAcBlock(lastContextTarget);
        if (lastExtractedTail) {
            log('Context AC tail: ' + lastExtractedTail);
        }
    }

    function startMenuObserver() {
        if (menuObserver) {
            return;
        }
        menuObserver = new MutationObserver(function () {
            scanForMenu();
        });
        try {
            menuObserver.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        } catch (e) {
            menuObserver = null;
        }
    }

    function init() {
        getOrCreateWorksheetTabIdForThisPage();
        ensureChannel();
        onCtx = onContextMenu;
        document.addEventListener('contextmenu', onCtx, true);
        startMenuObserver();
    }

    initTimer = setTimeout(init, 500);

    window.__myScriptCleanup = function () {
        if (initTimer) {
            clearTimeout(initTimer);
            initTimer = null;
        }
        if (onCtx) {
            try {
                document.removeEventListener('contextmenu', onCtx, true);
            } catch (e) {}
            onCtx = null;
        }
        if (menuObserver) {
            try {
                menuObserver.disconnect();
            } catch (e) {}
            menuObserver = null;
        }
        if (ch) {
            try {
                ch.close();
            } catch (e) {}
            ch = null;
        }
    };
})();
