// ==UserScript==
// @name         Alerts: send tails to worksheet
// @namespace    Wolf 2.0
// @version      0.1.0
// @description  /alerts: read Tail # from the anomaly table, send to a worksheet the user picks. Needs a worksheet with "Send late flights to WS Pax Conx" (ws_apply_tail).
// @match        https://opssuitemain.swacorp.com/alerts*
// @match        https://opssuitemain.swacorp.com/*/alerts*
// @grant        none
// @donkeycode-pref {"alertsTailsToWsLog":{"type":"boolean","group":"Alerts → WS","label":"Debug log","default":false,"description":"Console: tail parse, worksheet list, sends."},"alertsTailsToWsListWaitMs":{"type":"number","group":"Alerts → WS","label":"Worksheet list wait (ms)","default":2000,"min":100,"max":8000,"step":100,"description":"How long to wait for open worksheet tabs to answer ws_list."},"alertsTailsToWsSendMode":{"type":"select","group":"Alerts → WS","label":"Which rows to send","default":"all_visible","options":[{"val":"all_visible","label":"All rows currently in the table"},{"val":"checked_only","label":"Only rows with the row checkbox checked"}]},"alertsTailsToWsDeduplicate":{"type":"boolean","group":"Alerts → WS","label":"Deduplicate tails","description":"If the same tail appears in multiple rows, send it once.","default":true},"alertsTailsToWsStaggerMs":{"type":"number","group":"Alerts → WS","label":"Ms between each tail to worksheet","default":150,"min":0,"max":2000,"step":50,"description":"Small delay so the worksheet can apply one tail at a time."}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Alerts%20send%20tails%20to%20worksheet.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Alerts%20send%20tails%20to%20worksheet.user.js
// ==/UserScript==

(function () {
    'use strict';

    var BC_WS_NAME = 'dc_pax_late_to_ws_v1';
    var MOUNT_ID = 'dc-alerts-tails-ws-ui';
    var PICKER_ID = 'dc-alerts-tails-ws-picker';

    var ch = null;
    var mountTimer = 0;
    var mountObserver = null;

    function getPref(k, d) {
        if (typeof donkeycodeGetPref !== 'function') {
            return d;
        }
        var v = donkeycodeGetPref(k);
        if (v === undefined || v === null || v === '') {
            return d;
        }
        return v;
    }

    function log() {
        if (getPref('alertsTailsToWsLog', false) === false) {
            return;
        }
        try {
            console.log.apply(
                console,
                ['%c[Alerts→WS]', 'color:#2ecc71'].concat([].slice.call(arguments))
            );
        } catch (e) {}
    }

    function randomId() {
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
        var n = Number(getPref('alertsTailsToWsListWaitMs', 2000));
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
            var listId = randomId();
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

    var RE_N_TAIL = /N\d{1,5}[A-Z0-9]?/gi;

    function normalizeTailToken(s) {
        if (!s) {
            return '';
        }
        s = String(s)
            .replace(/\s+/g, '')
            .trim();
        if (!s) {
            return '';
        }
        var m = s.match(/N[0-9]{1,5}[A-Z0-9]*/i);
        if (m) {
            return m[0].toUpperCase();
        }
        return '';
    }

    function rowCheckboxChecked(tr) {
        if (!tr || !tr.querySelector) {
            return false;
        }
        var box =
            tr.querySelector('td:nth-child(2) .checkbox input[type="checkbox"]') ||
            tr.querySelector('td .checkbox input[type="checkbox"]');
        if (box) {
            return box.checked === true;
        }
        return false;
    }

    function tailsFromTable() {
        var tbody = document.querySelector('tbody[aria-label="anomaly-table-body"]');
        if (!tbody) {
            tbody = document.querySelector('table .ui.celled.table tbody');
        }
        if (!tbody) {
            return [];
        }
        var mode = getPref('alertsTailsToWsSendMode', 'all_visible');
        var rows = tbody.querySelectorAll('tr');
        var out = [];
        var i;
        for (i = 0; i < rows.length; i++) {
            var tr = rows[i];
            if (mode === 'checked_only' && !rowCheckboxChecked(tr)) {
                continue;
            }
            var cell =
                tr.querySelector('td[data-label="Tail #"]') ||
                tr.querySelector('[data-label="Tail #"]') ||
                null;
            if (!cell) {
                var tds = tr.querySelectorAll('td');
                if (tds.length >= 6) {
                    cell = tds[5];
                }
            }
            if (!cell) {
                continue;
            }
            var raw = String(cell.textContent || '');
            var m;
            var found = null;
            RE_N_TAIL.lastIndex = 0;
            while ((m = RE_N_TAIL.exec(raw)) !== null) {
                if (m[0] && /^N/i.test(m[0]) && m[0].length >= 4) {
                    found = m[0].toUpperCase();
                    break;
                }
            }
            if (found) {
                out.push(found);
            } else {
                var one = normalizeTailToken(raw);
                if (one) {
                    out.push(one);
                }
            }
        }
        if (getPref('alertsTailsToWsDeduplicate', true) !== false) {
            var seen = Object.create(null);
            var ded = [];
            for (i = 0; i < out.length; i++) {
                if (out[i] && !seen[out[i]]) {
                    seen[out[i]] = 1;
                    ded.push(out[i]);
                }
            }
            return ded;
        }
        return out;
    }

    function postApplyTail(tail, targetTabId) {
        var c = ensureChannel();
        if (!c) {
            return;
        }
        var id = randomId();
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
        log('ws_apply_tail tail=' + payload.tail + ' target=' + targetTabId);
    }

    function runSendTailsToTab(tails, targetTabId) {
        if (!tails || !tails.length || !targetTabId) {
            return;
        }
        var stagger = Number(getPref('alertsTailsToWsStaggerMs', 150));
        if (!Number.isFinite(stagger)) {
            stagger = 150;
        }
        stagger = Math.min(2000, Math.max(0, stagger));
        var n = 0;
        function next() {
            if (n >= tails.length) {
                return;
            }
            postApplyTail(tails[n], targetTabId);
            n++;
            if (n < tails.length && stagger > 0) {
                setTimeout(next, stagger);
            } else if (n < tails.length) {
                next();
            }
        }
        next();
    }

    function closePicker() {
        var p = document.getElementById(PICKER_ID);
        if (p) {
            try {
                p.remove();
            } catch (e) {}
        }
    }

    function showWorksheetPicker(tails) {
        if (!tails || !tails.length) {
            try {
                window.alert('No tails found in the table. Check filter/toggles, or your "Which rows" preference.');
            } catch (e) {}
            return;
        }
        closePicker();
        var backdrop = document.createElement('div');
        backdrop.id = PICKER_ID;
        backdrop.style.cssText =
            'position:fixed!important;inset:0!important;z-index:10000050!important;background:rgba(0,0,0,.55)!important;' +
            'display:flex!important;align-items:center!important;justify-content:center!important;';
        var panel = document.createElement('div');
        panel.style.cssText =
            'background:#1a1f24!important;color:#e8ecef!important;border-radius:10px!important;max-width:min(480px,92vw)!important;' +
            'max-height:min(70vh,520px)!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;' +
            'box-shadow:0 16px 48px rgba(0,0,0,.5)!important;border:1px solid #3d4a56!important;';
        var head = document.createElement('div');
        head.textContent = 'Send ' + tails.length + ' tail(s) to which worksheet?';
        head.style.cssText =
            'font:600 15px system-ui,sans-serif!important;padding:14px 16px!important;border-bottom:1px solid #334155!important;';
        var sub = document.createElement('div');
        sub.textContent = tails.join(', ');
        sub.style.cssText =
            'font:12px system-ui,sans-serif!important;padding:0 16px 10px!important;color:#94a3b8!important;word-break:break-word!important;';
        var body = document.createElement('div');
        body.style.cssText = 'padding:8px 12px!important;overflow:auto!important;flex:1;';
        body.appendChild(
            (function () {
                var load = document.createElement('div');
                load.textContent = 'Loading worksheets…';
                load.style.cssText = 'padding:12px!important;opacity:.85!important;';
                return load;
            })()
        );
        var foot = document.createElement('div');
        foot.style.cssText =
            'display:flex!important;gap:8px!important;justify-content:flex-end!important;padding:10px 12px!important;border-top:1px solid #334155!important;';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.style.cssText =
            'font:13px system-ui!important;padding:6px 12px!important;border-radius:5px!important;cursor:pointer!important;' +
            'background:#2d3748!important;color:#e2e8f0!important;border:1px solid #4a5568!important;';
        cancel.addEventListener('click', function () {
            try {
                backdrop.remove();
            } catch (e) {}
        });
        foot.appendChild(cancel);
        panel.appendChild(head);
        panel.appendChild(sub);
        panel.appendChild(body);
        panel.appendChild(foot);
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) {
                closePicker();
            }
        });
        panel.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        document.body.appendChild(backdrop);
        listWorksheetTabs().then(function (tabs) {
            body.innerHTML = '';
            if (!tabs || !tabs.length) {
                var err = document.createElement('div');
                err.textContent =
                    'No worksheet tabs found. Open at least one worksheet (with the Pax/late conx script) in this browser, then try again.';
                err.style.cssText = 'padding:10px 8px!important;color:#f6ad55!important;';
                body.appendChild(err);
                return;
            }
            var j;
            for (j = 0; j < tabs.length; j++) {
                (function (tab) {
                    var b = document.createElement('button');
                    b.type = 'button';
                    b.textContent = tab.title || tab.tabId;
                    b.title = 'Tab id: ' + (tab.tabId || '');
                    b.style.cssText =
                        'display:block!important;width:100%!important;text-align:left!important;margin:0 0 6px!important;' +
                        'font:14px system-ui!important;padding:10px 12px!important;border-radius:6px!important;cursor:pointer!important;' +
                        'background:#24303d!important;color:#e2e8f0!important;border:1px solid #3d4a56!important;';
                    b.addEventListener('click', function () {
                        runSendTailsToTab(tails, tab.tabId);
                        try {
                            backdrop.remove();
                        } catch (e) {}
                    });
                    body.appendChild(b);
                })(tabs[j]);
            }
        });
    }

    function onSendClick() {
        var tails = tailsFromTable();
        log('tails: ' + tails.length + (tails.length ? ' — ' + tails.join(' ') : ''));
        if (!tails.length) {
            try {
                window.alert(
                    'No N-number tails found. Expand filters or set "Which rows" to all rows.'
                );
            } catch (e) {}
            return;
        }
        if (!ensureChannel()) {
            try {
                window.alert('BroadcastChannel is not available in this browser.');
            } catch (e) {}
            return;
        }
        showWorksheetPicker(tails);
    }

    function mountIfNeeded() {
        if (document.getElementById(MOUNT_ID)) {
            return;
        }
        var pre = document.querySelector('[data-testid="alerts-preheat-toggle"]');
        if (!pre) {
            return;
        }
        var row = pre.closest('div.vEuf4OudPJEFpDZYr4wX');
        if (!row) {
            row = pre.closest(
                'div.field'
            ) && pre.closest('div.field').parentNode;
        }
        if (!row) {
            row = pre.parentNode && pre.parentNode.parentNode;
        }
        if (!row) {
            return;
        }
        var wrap = document.createElement('div');
        wrap.id = MOUNT_ID;
        wrap.className = 'field dtdZdbLbjSdDEZuktvkA';
        wrap.style.cssText = 'width:100%!important;';
        var inner = document.createElement('div');
        inner.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;gap:6px;';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Send alert tail(s) to worksheet…';
        btn.title =
            'Sends N-numbers from the table to the worksheet you pick (same as AC → WS).';
        btn.style.cssText =
            'font:600 13px system-ui,Segoe UI,sans-serif!important;border:none!important;border-radius:4px!important;' +
            'background:#1e3a4f!important;color:#ecf0f1!important;padding:8px 12px!important;cursor:pointer!important;';
        bindButtonActivate2(btn, onSendClick);
        var hint = document.createElement('div');
        hint.style.cssText = 'font:11px/1.35 system-ui!important;color:#8899a8!important;';
        hint.textContent =
            'Uses DonkeyCODE pref “Which rows to send”. Open a worksheet tab in this browser first.';

        inner.appendChild(btn);
        inner.appendChild(hint);
        wrap.appendChild(inner);
        var phField = pre.closest('div.field');
        if (phField && phField.parentNode === row) {
            if (phField.nextSibling) {
                row.insertBefore(wrap, phField.nextSibling);
            } else {
                row.appendChild(wrap);
            }
        } else {
            try {
                row.appendChild(wrap);
            } catch (e) {
                pre.parentNode.appendChild(wrap);
            }
        }
    }

    function bindButtonActivate2(el, run) {
        if (!el || el.getAttribute('data-dc-act') === '1') {
            return;
        }
        el.setAttribute('data-dc-act', '1');
        var didPointer = false;
        el.addEventListener(
            'pointerup',
            function (ev) {
                if (!ev || ev.isTrusted === false) {
                    return;
                }
                if (ev.button != null && ev.button !== 0) {
                    return;
                }
                didPointer = true;
                setTimeout(function () {
                    didPointer = false;
                }, 600);
                try {
                    if (ev.preventDefault) {
                        ev.preventDefault();
                    }
                    if (ev.stopPropagation) {
                        ev.stopPropagation();
                    }
                } catch (e) {}
                try {
                    run();
                } catch (e2) {}
            },
            true
        );
        el.addEventListener(
            'click',
            function (ev) {
                if (didPointer) {
                    try {
                        if (ev.preventDefault) {
                            ev.preventDefault();
                        }
                        if (ev.stopPropagation) {
                            ev.stopPropagation();
                        }
                    } catch (e) {}
                }
            },
            true
        );
    }

    function scheduleMount() {
        if (mountTimer) {
            return;
        }
        mountTimer = setTimeout(function () {
            mountTimer = 0;
            try {
                mountIfNeeded();
            } catch (e) {}
        }, 0);
    }

    function start() {
        ensureChannel();
        scheduleMount();
        if (mountObserver) {
            return;
        }
        try {
            mountObserver = new MutationObserver(scheduleMount);
            mountObserver.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        } catch (e) {
            mountObserver = null;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
    setTimeout(scheduleMount, 1000);
    setTimeout(scheduleMount, 3000);

    window.__myScriptCleanup = function () {
        if (mountObserver) {
            try {
                mountObserver.disconnect();
            } catch (e) {}
            mountObserver = null;
        }
        if (mountTimer) {
            try {
                clearTimeout(mountTimer);
            } catch (e) {}
            mountTimer = 0;
        }
        var u = document.getElementById(MOUNT_ID);
        if (u) {
            try {
                u.remove();
            } catch (e) {}
        }
        closePicker();
    };
})();
