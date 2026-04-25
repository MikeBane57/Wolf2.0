// ==UserScript==
// @name         AC context menu — send tail to worksheet
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  Right-click aircraft block: "Send tail to worksheet →" with submenus for each open /widgets/worksheet tab. Uses BroadcastChannel dc_pax_late_to_ws_v1 + ws_apply_tail (Pax late script on worksheet loads target).
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"acTailToWsEnabled":{"type":"boolean","group":"AC → worksheet","label":"Enable context menu","default":true},"acTailToWsListWaitMs":{"type":"number","group":"AC → worksheet","label":"Worksheet list wait (ms)","default":600,"min":100,"max":5000,"step":50,"description":"Time to collect worksheet tab titles before opening the flyout."},"acTailToWsLog":{"type":"boolean","group":"AC → worksheet","label":"Debug log","default":false}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20context%20menu%20-%20send%20tail%20to%20worksheet.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/AC%20context%20menu%20-%20send%20tail%20to%20worksheet.user.js
// ==/UserScript==

(function () {
    'use strict';

    var BC_WS_NAME = 'dc_pax_late_to_ws_v1';

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
        var n = Number(getPref('acTailToWsListWaitMs', 600));
        if (!Number.isFinite(n)) {
            return 600;
        }
        return Math.min(5000, Math.max(100, Math.floor(n)));
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
                }, 80);
            });
        });
    }

    function postApplyTailToWorksheet(tail, targetTabId) {
        var c = ensureChannel();
        if (!c) {
            return;
        }
        try {
            c.postMessage({
                t: 'ws_apply_tail',
                id: randomBcastId(),
                tail: String(tail || '').trim().toUpperCase(),
                targetTabId: targetTabId
            });
        } catch (e) {}
    }

    var RE_N_NUMBER = /N\d{1,5}[A-Z]?/i;

    function extractTailFromAcBlock(root) {
        if (!root || !root.querySelector) {
            return '';
        }
        var cand =
            (root.querySelector('div[class*="opUU"]') || root.querySelector('[class*="opUU"]') || null);
        var t = '';
        if (cand) {
            t = (cand.textContent || '').replace(/\s+/g, ' ').trim();
        }
        if (!t) {
            t = (root.textContent || '').replace(/\s+/g, ' ').trim();
        }
        if (!t) {
            return '';
        }
        var m = t.match(RE_N_NUMBER);
        if (m) {
            return m[0].toUpperCase();
        }
        m = t.match(/\b([A-Z]{1,2}\d{1,5}[A-Z]{0,2})\b/);
        return m ? m[1].toUpperCase() : '';
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
        if (!RE_N_NUMBER.test(String(lastExtractedTail || ''))) {
            if (getPref('acTailToWsLog', false) !== false) {
                log('No tail in last AC block, skip menu');
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
        sub.style.cssText =
            'display:none!important;position:absolute!important;left:100%!important;top:0!important;margin-left:2px!important;' +
            'min-width:220px!important;z-index:3000!important;background:#1b1b1b!important;border:1px solid #4a4a4a!important;' +
            'border-radius:4px!important;box-shadow:0 4px 16px rgba(0,0,0,.45)!important;padding:4px 0!important;max-height:50vh!important;overflow-y:auto!important;';
        var loading = document.createElement('div');
        loading.style.cssText =
            'padding:8px 12px!important;color:#bdc3c7!important;font:12px system-ui,sans-serif!important;';
        loading.textContent = 'Loading worksheets…';
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
                if (!tabs || !tabs.length) {
                    var d0 = document.createElement('div');
                    d0.style.cssText =
                        'padding:8px 12px!important;color:#e74c3c!important;max-width:280px!important;font:12px system-ui,sans-serif!important;';
                    d0.textContent =
                        'No worksheet tabs found. Open a /widgets/worksheet tab with Pax "late flights" (v1.9.8+).';
                    sub.appendChild(d0);
                    return;
                }
                var h = document.createElement('div');
                h.style.cssText =
                    'padding:6px 12px 4px!important;font:11px system-ui,sans-serif!important;color:#7f8c8d!important;border-bottom:1px solid #333!important;';
                h.textContent = 'AC ' + String(lastExtractedTail);
                sub.appendChild(h);
                var j;
                for (j = 0; j < tabs.length; j++) {
                    (function (tab) {
                        var row = document.createElement('a');
                        row.href = '#';
                        row.textContent = tab.title || tab.tabId;
                        row.style.cssText =
                            'display:block!important;padding:8px 12px!important;color:#ecf0f1!important;font:13px system-ui,sans-serif!important;text-decoration:none!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;';
                        row.addEventListener('click', function (e) {
                            e.preventDefault();
                            e.stopPropagation();
                            postApplyTailToWorksheet(
                                lastExtractedTail,
                                tab.tabId
                            );
                            log('Sent ' + lastExtractedTail + ' to tab ' + (tab.title || tab.tabId));
                        });
                        row.addEventListener('mouseenter', function () {
                            row.style.background = 'rgba(255,255,255,0.08)';
                        });
                        row.addEventListener('mouseleave', function () {
                            row.style.background = 'transparent';
                        });
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
            menu.insertBefore(wrap, firstItem);
        } catch (e) {
            menu.appendChild(wrap);
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
        var inBlock = el.closest
            ? el.closest('div.AoJn2gDrLWo, [class*="AoJn2gDrLWo"]')
            : null;
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
