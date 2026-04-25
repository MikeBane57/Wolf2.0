// ==UserScript==
// @name         WS state/reload
// @namespace    Wolf 2.0
// @version      0.1.0
// @description  Worksheet: save named AC tail/line states, recall them later, and quick reload/restore current worksheet state.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/WS%20state-reload.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/WS%20state-reload.user.js
// ==/UserScript==

(function () {
    'use strict';

    var SCRIPT = 'WS State';
    var HOST_ID = 'dc-ws-state-reload-host';
    var STYLE_ID = 'dc-ws-state-reload-style';
    var MODAL_ATTR = 'data-dc-ws-state-modal';
    var LS_STATES = 'dc_ws_state_reload_named_states_v1';
    var SS_QUICK_STATE = 'dc_ws_state_reload_quick_state_v1';
    var SS_QUICK_RESTORE = 'dc_ws_state_reload_restore_after_reload_v1';
    var WX_BTN_SELECTOR = '[data-dc-metar-watch-btn="1"]';

    var mountObserver = null;
    var mountRaf = 0;
    var restoreTimer = null;
    var activeApplyTimer = null;

    function isWorksheetPage() {
        try {
            return String(location.pathname || '').indexOf('/widgets/worksheet') === 0;
        } catch (e) {
            return false;
        }
    }

    function trimText(s) {
        return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    }

    function nowIso() {
        try {
            return new Date().toISOString();
        } catch (e) {
            return String(Date.now());
        }
    }

    function safeJsonParse(raw, fallback) {
        try {
            if (!raw) {
                return fallback;
            }
            var parsed = JSON.parse(raw);
            return parsed || fallback;
        } catch (e) {
            return fallback;
        }
    }

    function readStateStore() {
        var raw = '';
        try {
            raw = localStorage.getItem(LS_STATES) || '';
        } catch (e) {}
        var store = safeJsonParse(raw, null);
        if (!store || !Array.isArray(store.states)) {
            return { version: 1, states: [] };
        }
        return store;
    }

    function writeStateStore(store) {
        try {
            localStorage.setItem(LS_STATES, JSON.stringify(store || { version: 1, states: [] }));
            return true;
        } catch (e) {
            return false;
        }
    }

    function stateId() {
        return 'st-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    }

    function formatDate(ts) {
        try {
            return new Date(ts).toLocaleString();
        } catch (e) {
            return ts || '';
        }
    }

    function itemSummary(items) {
        var tails = 0;
        var lines = 0;
        var i;
        for (i = 0; i < (items || []).length; i++) {
            if (items[i] && items[i].type === 'line') {
                lines++;
            } else if (items[i] && items[i].type === 'tail') {
                tails++;
            }
        }
        return tails + ' tail' + (tails === 1 ? '' : 's') + ', ' + lines + ' line' + (lines === 1 ? '' : 's');
    }

    function toast(msg, isError) {
        try {
            var old = document.querySelector('[data-dc-ws-state-toast="1"]');
            if (old) {
                old.remove();
            }
            var el = document.createElement('div');
            el.setAttribute('data-dc-ws-state-toast', '1');
            el.textContent = SCRIPT + ': ' + msg;
            el.style.cssText =
                'position:fixed;right:14px;bottom:14px;z-index:10000050;padding:8px 12px;border-radius:6px;' +
                'font:12px/1.35 system-ui,Segoe UI,sans-serif;color:#fff;background:' +
                (isError ? '#9b2d2d' : '#1f5f3d') +
                ';box-shadow:0 3px 16px rgba(0,0,0,.35);max-width:min(420px,calc(100vw - 28px));';
            document.body.appendChild(el);
            setTimeout(function () {
                try {
                    if (el.parentNode) {
                        el.remove();
                    }
                } catch (e) {}
            }, isError ? 6500 : 4200);
        } catch (e2) {}
    }

    function isVisible(el) {
        if (!el || !el.ownerDocument) {
            return false;
        }
        try {
            var cs = window.getComputedStyle(el);
            if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
                return false;
            }
            var r = el.getBoundingClientRect();
            return r && r.width > 0 && r.height > 0;
        } catch (e) {
            return false;
        }
    }

    function isIgnoredNode(el) {
        if (!el || !el.closest) {
            return true;
        }
        if (el.closest('#' + HOST_ID) || el.closest('[' + MODAL_ATTR + ']')) {
            return true;
        }
        if (el.closest('.field') || el.closest('[role="listbox"]') || el.closest('.menu')) {
            return true;
        }
        if (el.closest('script,style,noscript,textarea,input,select,button')) {
            return true;
        }
        return false;
    }

    function validTailFromText(text) {
        var matches = trimText(text).toUpperCase().match(/\bN[0-9A-Z]{2,6}\b/g);
        if (!matches || !matches.length) {
            return '';
        }
        var i;
        for (i = 0; i < matches.length; i++) {
            if (matches[i] !== 'NXXXXX' && matches[i] !== 'NXXXX') {
                return matches[i];
            }
        }
        return '';
    }

    function lineFromText(text) {
        var t = trimText(text);
        var m = t.match(/(?:^|\s)#\s*(\d{1,4})(?:\b|$)/);
        if (m) {
            return String(parseInt(m[1], 10));
        }
        return '';
    }

    function hasMatchingDescendant(el) {
        var kids = el.querySelectorAll('div,span');
        var i;
        for (i = 0; i < kids.length; i++) {
            if (kids[i] === el || isIgnoredNode(kids[i]) || !isVisible(kids[i])) {
                continue;
            }
            var t = trimText(kids[i].textContent || '');
            if (t.length > 0 && t.length <= 90 && (validTailFromText(t) || lineFromText(t))) {
                return true;
            }
        }
        return false;
    }

    function collectWorksheetState() {
        var root =
            document.querySelector('[role="main"]') ||
            document.querySelector('main') ||
            document.getElementById('smart-widget') ||
            document.body;
        var nodes = root ? root.querySelectorAll('div,span') : [];
        var seen = Object.create(null);
        var items = [];
        var i;
        for (i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (isIgnoredNode(el) || !isVisible(el)) {
                continue;
            }
            var text = trimText(el.textContent || '');
            if (!text || text.length > 180) {
                continue;
            }

            var tail = validTailFromText(text);
            if (tail) {
                var kt = 'tail:' + tail;
                if (!seen[kt]) {
                    seen[kt] = true;
                    items.push({ type: 'tail', value: tail });
                }
                continue;
            }

            if (hasMatchingDescendant(el)) {
                continue;
            }
            var line = lineFromText(text);
            if (line) {
                var kl = 'line:' + line;
                if (!seen[kl]) {
                    seen[kl] = true;
                    items.push({ type: 'line', value: line });
                }
            }
        }
        return {
            version: 1,
            capturedAt: nowIso(),
            title: trimText(document.title || 'Worksheet'),
            url: String(location.href || ''),
            items: items
        };
    }

    function findGmtClockElement() {
        var scopes = [];
        var h = document.querySelector('header');
        if (h) {
            scopes.push(h);
        }
        var tb = document.querySelector('[class*="toolbar"],[class*="Toolbar"],[class*="topbar"],[class*="TopBar"],[class*="app-bar"]');
        if (tb) {
            scopes.push(tb);
        }
        if (!scopes.length) {
            scopes.push(document.body);
        }
        var si;
        var sj;
        for (si = 0; si < scopes.length; si++) {
            var candidates = scopes[si].querySelectorAll('span,div,button,p,time,li');
            for (sj = 0; sj < candidates.length; sj++) {
                var el = candidates[sj];
                var t = trimText(el.textContent || '');
                if (t.length > 120 || !/\d{1,2}:\d{2}/.test(t)) {
                    continue;
                }
                if (/GMT|Zulu|\bUTC\b|\(Z\)/i.test(t)) {
                    return el;
                }
            }
        }
        return null;
    }

    function findMountAnchor() {
        var wx = document.querySelector(WX_BTN_SELECTOR);
        if (wx) {
            return wx;
        }
        return findGmtClockElement();
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent =
            '#' +
            HOST_ID +
            '{display:inline-flex;align-items:stretch;gap:4px;margin-left:8px;vertical-align:middle;}' +
            '#' +
            HOST_ID +
            ' button{font:600 12px system-ui,Segoe UI,sans-serif;border:1px solid rgba(255,255,255,.25);border-radius:4px;' +
            'background:#273847;color:#ecf0f1;padding:0 8px;min-height:28px;cursor:pointer;white-space:nowrap;}' +
            '#' +
            HOST_ID +
            ' button:hover{background:#34495e;}' +
            '#' +
            HOST_ID +
            ' button[data-dc-ws-quick]{background:#6b4a1f;}' +
            '[' +
            MODAL_ATTR +
            ']{position:fixed;inset:0;z-index:10000040;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-panel{width:min(620px,calc(100vw - 24px));max-height:min(82vh,760px);overflow:hidden;display:flex;flex-direction:column;' +
            'background:#20242b;color:#ecf0f1;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.55);font:13px/1.35 system-ui,Segoe UI,sans-serif;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid #374250;font-weight:700;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-body{padding:12px 14px;overflow:auto;display:flex;flex-direction:column;gap:8px;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:8px;border:1px solid #3f4a56;border-radius:7px;background:#262c34;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-name{font-weight:700;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-meta{font-size:11px;color:#b9c4cf;margin-top:2px;}' +
            '[' +
            MODAL_ATTR +
            '] button{font:600 12px system-ui,Segoe UI,sans-serif;border:1px solid #56616f;border-radius:5px;background:#2f3d4d;color:#ecf0f1;padding:6px 10px;cursor:pointer;}' +
            '[' +
            MODAL_ATTR +
            '] button:hover{background:#3c4f63;}' +
            '[' +
            MODAL_ATTR +
            '] button.dc-wss-danger{border-color:#7e3c3c;background:#4c2424;}';
        document.head.appendChild(st);
    }

    function makeButton(label, title, attrName, onClick) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.title = title;
        if (attrName) {
            btn.setAttribute(attrName, '1');
        }
        btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            onClick();
        });
        return btn;
    }

    function mountControls() {
        if (!isWorksheetPage() || !document.body) {
            return;
        }
        ensureStyle();
        var host = document.getElementById(HOST_ID);
        if (!host) {
            host = document.createElement('span');
            host.id = HOST_ID;
            host.appendChild(makeButton('Save state', 'Save visible AC tails and N/A line fallbacks as a named state', '', saveCurrentState));
            host.appendChild(makeButton('Recall state', 'Recall one saved worksheet state', '', openRecallDialog));
            host.appendChild(makeButton('Quick reload', 'Temporarily save current state, hard reload this page, then restore it', 'data-dc-ws-quick', quickReload));
        }
        var anchor = findMountAnchor();
        if (anchor && anchor.parentNode) {
            var parent = anchor.parentNode;
            host.style.position = '';
            host.style.right = '';
            host.style.top = '';
            host.style.zIndex = '';
            if (host.parentNode !== parent || host.previousSibling !== anchor) {
                parent.insertBefore(host, anchor.nextSibling);
            }
            try {
                var row = anchor.parentElement;
                if (row) {
                    var cs = window.getComputedStyle(row);
                    if (cs && cs.display !== 'flex' && cs.display !== 'inline-flex') {
                        row.style.display = 'flex';
                        row.style.alignItems = 'stretch';
                    }
                }
            } catch (e) {}
        } else if (host.parentNode !== document.body) {
            host.style.position = 'fixed';
            host.style.right = '12px';
            host.style.top = '12px';
            host.style.zIndex = '99999';
            document.body.appendChild(host);
        }
    }

    function scheduleMount() {
        if (mountRaf) {
            return;
        }
        mountRaf = requestAnimationFrame(function () {
            mountRaf = 0;
            mountControls();
        });
    }

    function defaultStateName() {
        var d = new Date();
        var pad = function (n) {
            return n < 10 ? '0' + n : String(n);
        };
        return 'WS ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function saveCurrentState() {
        var state = collectWorksheetState();
        if (!state.items.length) {
            toast('No visible tails or N/A line numbers found to save.', true);
            return;
        }
        var name = window.prompt('Name this worksheet state:', defaultStateName());
        if (name == null) {
            return;
        }
        name = trimText(name);
        if (!name) {
            toast('State name is required.', true);
            return;
        }
        var store = readStateStore();
        var existingIndex = -1;
        var i;
        for (i = 0; i < store.states.length; i++) {
            if (String(store.states[i].name || '').toLowerCase() === name.toLowerCase()) {
                existingIndex = i;
                break;
            }
        }
        state.id = existingIndex >= 0 ? store.states[existingIndex].id || stateId() : stateId();
        state.name = name;
        state.updatedAt = nowIso();
        if (existingIndex >= 0) {
            if (!window.confirm('Replace saved state "' + name + '"?')) {
                return;
            }
            store.states[existingIndex] = state;
        } else {
            store.states.unshift(state);
        }
        if (writeStateStore(store)) {
            toast('Saved "' + name + '" (' + itemSummary(state.items) + ').', false);
        } else {
            toast('Could not save state. Browser storage may be full or blocked.', true);
        }
    }

    function closeModal() {
        var m = document.querySelector('[' + MODAL_ATTR + '="1"]');
        if (m) {
            try {
                m.remove();
            } catch (e) {}
        }
    }

    function openRecallDialog() {
        closeModal();
        var store = readStateStore();
        var overlay = document.createElement('div');
        overlay.setAttribute(MODAL_ATTR, '1');
        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay) {
                closeModal();
            }
        });

        var panel = document.createElement('div');
        panel.className = 'dc-wss-panel';
        panel.addEventListener('click', function (ev) {
            ev.stopPropagation();
        });

        var head = document.createElement('div');
        head.className = 'dc-wss-head';
        var title = document.createElement('div');
        title.textContent = 'Recall worksheet state';
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', closeModal);
        head.appendChild(title);
        head.appendChild(close);

        var body = document.createElement('div');
        body.className = 'dc-wss-body';
        if (!store.states.length) {
            var empty = document.createElement('div');
            empty.textContent = 'No saved states yet. Use Save state first.';
            body.appendChild(empty);
        } else {
            var i;
            for (i = 0; i < store.states.length; i++) {
                body.appendChild(buildStateRow(store.states[i]));
            }
        }

        panel.appendChild(head);
        panel.appendChild(body);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    function buildStateRow(state) {
        var row = document.createElement('div');
        row.className = 'dc-wss-row';
        var info = document.createElement('div');
        var name = document.createElement('div');
        name.className = 'dc-wss-name';
        name.textContent = state.name || '(unnamed)';
        var meta = document.createElement('div');
        meta.className = 'dc-wss-meta';
        meta.textContent = itemSummary(state.items) + ' - saved ' + formatDate(state.updatedAt || state.capturedAt);
        info.appendChild(name);
        info.appendChild(meta);

        var recall = document.createElement('button');
        recall.type = 'button';
        recall.textContent = 'Recall';
        recall.addEventListener('click', function () {
            closeModal();
            applyStateToWorksheet(state, 'state "' + (state.name || '(unnamed)') + '"');
        });

        var del = document.createElement('button');
        del.type = 'button';
        del.textContent = 'Delete';
        del.className = 'dc-wss-danger';
        del.addEventListener('click', function () {
            if (!window.confirm('Delete saved state "' + (state.name || '(unnamed)') + '"?')) {
                return;
            }
            deleteState(state.id);
            openRecallDialog();
        });

        row.appendChild(info);
        row.appendChild(recall);
        row.appendChild(del);
        return row;
    }

    function deleteState(id) {
        var store = readStateStore();
        var next = [];
        var i;
        for (i = 0; i < store.states.length; i++) {
            if (store.states[i].id !== id) {
                next.push(store.states[i]);
            }
        }
        store.states = next;
        writeStateStore(store);
    }

    function quickReload() {
        var state = collectWorksheetState();
        if (!state.items.length) {
            toast('No visible tails or N/A line numbers found for quick reload.', true);
            return;
        }
        try {
            sessionStorage.setItem(SS_QUICK_STATE, JSON.stringify(state));
            sessionStorage.setItem(SS_QUICK_RESTORE, '1');
        } catch (e) {
            toast('Could not save temporary reload state.', true);
            return;
        }
        toast('Saved temporary state (' + itemSummary(state.items) + '), reloading...', false);
        setTimeout(function () {
            try {
                window.location.reload(true);
            } catch (e2) {
                try {
                    window.location.reload();
                } catch (e3) {
                    location.href = location.href;
                }
            }
        }, 250);
    }

    function findWorksheetInput(name) {
        var host = document.querySelector('div[name="' + name + '"]');
        if (!host) {
            return null;
        }
        return host.querySelector('input.search, input[aria-autocomplete="list"], input[type="text"]');
    }

    function setInputAndCommit(input, value) {
        if (!input) {
            return false;
        }
        try {
            input.focus();
            input.click();
        } catch (e) {}
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (setter && setter.set) {
            setter.set.call(input, String(value));
        } else {
            input.value = String(value);
        }
        input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        try {
            input.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                })
            );
            input.dispatchEvent(
                new KeyboardEvent('keyup', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                })
            );
        } catch (e2) {}
        return true;
    }

    function applyStateToWorksheet(state, label) {
        if (!state || !Array.isArray(state.items) || !state.items.length) {
            toast('Selected state is empty.', true);
            return;
        }
        if (activeApplyTimer) {
            clearTimeout(activeApplyTimer);
            activeApplyTimer = null;
        }
        var items = state.items.slice();
        var index = 0;
        var applied = 0;
        toast('Applying ' + items.length + ' item(s) from ' + label + '...', false);

        function next() {
            if (index >= items.length) {
                toast('Done applying ' + applied + ' of ' + items.length + ' item(s).', applied !== items.length);
                activeApplyTimer = null;
                return;
            }
            var item = items[index++];
            var field = item && item.type === 'line' ? 'line' : 'tail';
            var input = findWorksheetInput(field);
            if (!input) {
                toast('Could not find worksheet ' + field.toUpperCase() + ' input.', true);
                activeApplyTimer = null;
                return;
            }
            if (setInputAndCommit(input, item.value)) {
                applied++;
            }
            activeApplyTimer = setTimeout(next, 180);
        }

        next();
    }

    function restoreAfterQuickReloadIfNeeded() {
        var should = false;
        var raw = '';
        try {
            should = sessionStorage.getItem(SS_QUICK_RESTORE) === '1';
            raw = sessionStorage.getItem(SS_QUICK_STATE) || '';
        } catch (e) {}
        if (!should || !raw) {
            return;
        }
        var state = safeJsonParse(raw, null);
        try {
            sessionStorage.removeItem(SS_QUICK_RESTORE);
            sessionStorage.removeItem(SS_QUICK_STATE);
        } catch (e2) {}
        if (!state || !state.items || !state.items.length) {
            toast('Temporary reload state was empty.', true);
            return;
        }
        var tries = 0;
        var maxTries = 80;
        function waitAndApply() {
            tries++;
            if (findWorksheetInput('tail') || findWorksheetInput('line')) {
                applyStateToWorksheet(state, 'quick reload');
                restoreTimer = null;
                return;
            }
            if (tries >= maxTries) {
                toast('Worksheet inputs were not ready after reload; quick restore stopped.', true);
                restoreTimer = null;
                return;
            }
            restoreTimer = setTimeout(waitAndApply, 250);
        }
        waitAndApply();
    }

    function init() {
        if (!isWorksheetPage()) {
            return;
        }
        mountControls();
        restoreAfterQuickReloadIfNeeded();
        mountObserver = new MutationObserver(scheduleMount);
        mountObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.__wsStateReloadCleanup = function () {
        if (mountObserver) {
            mountObserver.disconnect();
            mountObserver = null;
        }
        if (mountRaf) {
            cancelAnimationFrame(mountRaf);
            mountRaf = 0;
        }
        if (restoreTimer) {
            clearTimeout(restoreTimer);
            restoreTimer = null;
        }
        if (activeApplyTimer) {
            clearTimeout(activeApplyTimer);
            activeApplyTimer = null;
        }
        closeModal();
        try {
            var host = document.getElementById(HOST_ID);
            if (host) {
                host.remove();
            }
            var style = document.getElementById(STYLE_ID);
            if (style) {
                style.remove();
            }
        } catch (e) {}
        window.__wsStateReloadCleanup = undefined;
    };
})();
