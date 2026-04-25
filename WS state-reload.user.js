// ==UserScript==
// @name         WS state/reload
// @namespace    Wolf 2.0
// @version      0.1.0
// @description  Worksheet: save named AC tail/line states, recall them later, quick reload/restore, and optionally share cloud states.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @donkeycode-pref {"worksheetStateTeamKey":{"type":"string","group":"Worksheet state cloud","label":"Team key","description":"Shared key for cloud saves. Defaults to wallOfFameTeamKey if blank.","default":""},"worksheetStateDataOwner":{"type":"string","group":"Worksheet state cloud","label":"JSON repo owner","description":"Repo owner for cloud worksheet states.","default":"","placeholder":"MikeBane57"},"worksheetStateDataRepo":{"type":"string","group":"Worksheet state cloud","label":"JSON repo name","description":"Repo containing WORKSHEET STATES/worksheet-states.json.","default":"","placeholder":"Wolf2.0"},"worksheetStateDataBranch":{"type":"string","group":"Worksheet state cloud","label":"JSON branch","default":"","placeholder":"main"},"worksheetStateRepoPath":{"type":"string","group":"Worksheet state cloud","label":"JSON path","description":"Path for shared cloud states.","default":"","placeholder":"WORKSHEET STATES/worksheet-states.json"}}
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
    var STATE_TTL_MS = 4 * 60 * 60 * 1000;
    var GITHUB_OWNER = 'MikeBane57';
    var GITHUB_REPO = 'Wolf2.0';
    var GITHUB_BRANCH = 'main';
    var CLOUD_FILE_PATH = 'WORKSHEET STATES/worksheet-states.json';
    var CLOUD_EVENT_TYPE = 'worksheet-state-put';

    var mountObserver = null;
    var mountRaf = 0;
    var restoreTimer = null;
    var activeApplyTimer = null;
    var cloudRowsHost = null;
    var localRowsHost = null;

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

    function resolvedGithubPat() {
        return trimText(getPref('donkeycode_github_pat', ''));
    }

    function resolvedCloudOwner() {
        return trimText(getPref('worksheetStateDataOwner', '')) || GITHUB_OWNER;
    }

    function resolvedCloudRepo() {
        return trimText(getPref('worksheetStateDataRepo', '')) || GITHUB_REPO;
    }

    function resolvedCloudBranch() {
        return trimText(getPref('worksheetStateDataBranch', '')) || GITHUB_BRANCH;
    }

    function resolvedCloudPath() {
        return (trimText(getPref('worksheetStateRepoPath', '')) || CLOUD_FILE_PATH).replace(/^\/+/, '');
    }

    function resolvedTeamKey() {
        return trimText(getPref('worksheetStateTeamKey', '')) || trimText(getPref('wallOfFameTeamKey', ''));
    }

    function githubApiHeaders() {
        return {
            Authorization: 'Bearer ' + resolvedGithubPat(),
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    }

    function encodedRepoPath(path) {
        return String(path || '')
            .replace(/^\/+/, '')
            .split('/')
            .map(encodeURIComponent)
            .join('/');
    }

    function rawCloudUrl() {
        return (
            'https://raw.githubusercontent.com/' +
            encodeURIComponent(resolvedCloudOwner()) +
            '/' +
            encodeURIComponent(resolvedCloudRepo()) +
            '/' +
            encodeURIComponent(resolvedCloudBranch()) +
            '/' +
            encodedRepoPath(resolvedCloudPath())
        );
    }

    function githubContentsApiUrl() {
        return (
            'https://api.github.com/repos/' +
            encodeURIComponent(resolvedCloudOwner()) +
            '/' +
            encodeURIComponent(resolvedCloudRepo()) +
            '/contents/' +
            encodedRepoPath(resolvedCloudPath())
        );
    }

    function activeDonkeyCodeFolder() {
        var keys = [
            'donkeycode_session_folder',
            'donkeycode_active_session_folder',
            'donkeycode_github_sessions_root',
            'donkeycode_sessions_root',
            'donkeycode_folder',
            'donkeycode_current_folder'
        ];
        var i;
        for (i = 0; i < keys.length; i++) {
            var v = trimText(getPref(keys[i], ''));
            if (v) {
                return v.replace(/^\/+|\/+$/g, '') || 'Default';
            }
        }
        return 'Default';
    }

    function decodeGithubFileContent(b64) {
        if (!b64) {
            return '';
        }
        var clean = String(b64).replace(/\s/g, '');
        var bin = atob(clean);
        try {
            return decodeURIComponent(escape(bin));
        } catch (e) {
            return bin;
        }
    }


    function normalizeCloudState(state) {
        if (!state || typeof state !== 'object' || !Array.isArray(state.items) || !state.items.length) {
            return null;
        }
        var savedAt = trimText(state.savedAt || state.updatedAt || state.capturedAt || nowIso());
        var folder = trimText(state.folder || state.folderName || 'Default') || 'Default';
        var id = trimText(state.id) || stateId();
        return {
            id: id,
            name: trimText(state.name) || '(unnamed)',
            folder: folder,
            savedAt: savedAt,
            expiresAt: trimText(state.expiresAt) || expiresAtFor(savedAt),
            title: trimText(state.title || ''),
            url: trimText(state.url || ''),
            items: state.items
                .map(function (item) {
                    if (!item || typeof item !== 'object') {
                        return null;
                    }
                    var type = item.type === 'line' ? 'line' : 'tail';
                    var value = trimText(item.value);
                    if (!value) {
                        return null;
                    }
                    return { type: type, value: value };
                })
                .filter(Boolean)
        };
    }

    function parseCloudDocument(text) {
        var doc = safeJsonParse(text, null);
        var arr = doc && Array.isArray(doc.states) ? doc.states : Array.isArray(doc) ? doc : [];
        var out = [];
        var changed = false;
        var i;
        for (i = 0; i < arr.length; i++) {
            var st = normalizeCloudState(arr[i]);
            if (!st || isExpiredState(st)) {
                changed = true;
                continue;
            }
            out.push(st);
        }
        return { version: 1, states: out, updatedAt: Date.now(), _prunedExpired: changed || out.length !== arr.length };
    }

    function cloudDocFor(states) {
        return {
            version: 1,
            updatedAt: Date.now(),
            ttlMs: STATE_TTL_MS,
            states: (states || [])
                .map(normalizeCloudState)
                .filter(Boolean)
                .filter(function (st) {
                    return !isExpiredState(st);
                })
        };
    }

    function gmXhr(method, url, headers, bodyObj, cb) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            cb(0, '');
            return;
        }
        var hasBody = bodyObj !== undefined && bodyObj !== null;
        var data = hasBody ? (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)) : undefined;
        GM_xmlhttpRequest({
            method: method,
            url: url,
            headers: headers || {},
            data: data,
            onload: function (res) {
                cb(res.status || 0, res.responseText || '');
            },
            onerror: function () {
                cb(0, '');
            }
        });
    }

    function rawGithubGetCloud(cb) {
        gmXhr('GET', rawCloudUrl(), { Accept: 'application/json' }, null, function (status, text) {
            if (status === 404) {
                cb(cloudDocFor([]));
                return;
            }
            if (status < 200 || status >= 300) {
                cb(null);
                return;
            }
            cb(parseCloudDocument(text || '{"states":[]}'));
        });
    }

    function githubGetCloud(cb) {
        if (!resolvedGithubPat()) {
            cb(null);
            return;
        }
        gmXhr(
            'GET',
            githubContentsApiUrl() + '?ref=' + encodeURIComponent(resolvedCloudBranch()),
            githubApiHeaders(),
            null,
            function (status, text) {
                if (status === 404) {
                    cb(cloudDocFor([]));
                    return;
                }
                if (status < 200 || status >= 300) {
                    cb(null);
                    return;
                }
                var meta = safeJsonParse(text, null);
                if (!meta) {
                    cb(null);
                    return;
                }
                cb(parseCloudDocument(decodeGithubFileContent(meta.content || '')));
            }
        );
    }

    function fetchCloudStates(cb) {
        rawGithubGetCloud(function (doc) {
            if (doc) {
                cb(doc);
                return;
            }
            githubGetCloud(cb);
        });
    }

    function dispatchCloudDoc(doc, cb) {
        if (!resolvedTeamKey()) {
            cb(false, 'Set worksheetStateTeamKey or wallOfFameTeamKey in DonkeyCODE prefs.');
            return;
        }
        if (!resolvedGithubPat()) {
            cb(false, 'Set donkeycode_github_pat in DonkeyCODE prefs so repository_dispatch can run.');
            return;
        }
        var headers = githubApiHeaders();
        headers['Content-Type'] = 'application/json';
        var body = {
            event_type: CLOUD_EVENT_TYPE,
            client_payload: {
                team_key: resolvedTeamKey(),
                document: cloudDocFor(doc.states || []),
                path: resolvedCloudPath()
            }
        };
        var url =
            'https://api.github.com/repos/' +
            encodeURIComponent(resolvedCloudOwner()) +
            '/' +
            encodeURIComponent(resolvedCloudRepo()) +
            '/dispatches';
        gmXhr('POST', url, headers, body, function (status, text) {
            if (status === 204) {
                cb(true, null);
                return;
            }
            cb(false, 'Cloud save dispatch failed: HTTP ' + status + (text ? ' ' + text.slice(0, 240) : ''));
        });
    }

    function saveCurrentStateToCloud() {
        var state = collectWorksheetState();
        if (!state.items.length) {
            toast('No visible tails or N/A line numbers found to save to cloud.', true);
            return;
        }
        var folder = activeDonkeyCodeFolder();
        var name = window.prompt('Name this cloud worksheet state:', defaultStateName());
        if (name == null) {
            return;
        }
        name = trimText(name);
        if (!name) {
            toast('Cloud state name is required.', true);
            return;
        }
        if (!window.confirm('Save "' + name + '" to shared cloud states for folder "' + folder + '"?')) {
            return;
        }
        state.id = stateId();
        state.name = name;
        state.folder = folder;
        state.savedAt = nowIso();
        state.updatedAt = state.savedAt;
        state.expiresAt = expiresAtFor(state.savedAt);
        toast('Loading cloud states before save...', false);
        fetchCloudStates(function (doc) {
            if (!doc) {
                toast('Could not load cloud states. Check GitHub permissions/host access.', true);
                return;
            }
            var states = (doc.states || []).filter(function (st) {
                return st && st.id !== state.id && !isExpiredState(st);
            });
            states.unshift(normalizeCloudState(state));
            dispatchCloudDoc(cloudDocFor(states), function (ok, err) {
                if (!ok) {
                    toast(err || 'Cloud save failed.', true);
                    return;
                }
                toast('Cloud save requested for "' + name + '". It may take a moment to appear.', false);
                refreshCloudRows();
            });
        });
    }

    function refreshCloudRows() {
        if (!cloudRowsHost) {
            return;
        }
        cloudRowsHost.textContent = 'Loading cloud states...';
        fetchCloudStates(function (doc) {
            if (!cloudRowsHost) {
                return;
            }
            cloudRowsHost.textContent = '';
            if (!doc) {
                cloudRowsHost.textContent = 'Could not load cloud states. Check DonkeyCODE host access/PAT or wait for the workflow file to exist.';
                return;
            }
            var folder = activeDonkeyCodeFolder();
            var states = (doc.states || []).filter(function (st) {
                return st && !isExpiredState(st);
            });
            states.sort(function (a, b) {
                return String(b.savedAt || b.updatedAt || '').localeCompare(String(a.savedAt || a.updatedAt || ''));
            });
            if (!states.length) {
                cloudRowsHost.textContent = 'No unexpired cloud states found.';
                return;
            }
            var sameFolder = states.filter(function (st) {
                return trimText(st.folder) === folder;
            });
            var list = sameFolder.concat(
                states.filter(function (st) {
                    return trimText(st.folder) !== folder;
                })
            );
            for (var i = 0; i < list.length; i++) {
                cloudRowsHost.appendChild(buildCloudStateRow(list[i], folder));
            }
        });
    }

    function buildCloudStateRow(state, activeFolder) {
        var row = document.createElement('div');
        row.className = 'dc-wss-row';
        var info = document.createElement('div');
        var name = document.createElement('div');
        name.className = 'dc-wss-name';
        name.textContent = state.name || '(unnamed)';
        var meta = document.createElement('div');
        meta.className = 'dc-wss-meta';
        meta.textContent =
            'Folder ' +
            (state.folder || 'Default') +
            (state.folder === activeFolder ? ' (current)' : '') +
            ' - ' +
            itemSummary(state.items) +
            ' - saved ' +
            formatDate(state.savedAt || state.updatedAt || state.capturedAt) +
            ' - ' +
            formatExpiresLabel(state.expiresAt);
        info.appendChild(name);
        info.appendChild(meta);

        var recall = document.createElement('button');
        recall.type = 'button';
        recall.textContent = 'Recall';
        recall.addEventListener('click', function () {
            closeModal();
            applyStateToWorksheet(state, 'cloud state "' + (state.name || '(unnamed)') + '"');
        });

        var spacer = document.createElement('span');
        row.appendChild(info);
        row.appendChild(recall);
        row.appendChild(spacer);
        return row;
    }

    function openCloudDialog() {
        closeModal();
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
        title.textContent = 'Cloud worksheet states';
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', closeModal);
        head.appendChild(title);
        head.appendChild(close);

        var body = document.createElement('div');
        body.className = 'dc-wss-body';
        var note = document.createElement('div');
        note.className = 'dc-wss-note';
        note.textContent =
            'Current DonkeyCODE folder: ' +
            activeDonkeyCodeFolder() +
            '. Cloud saves are shared with all users and expire after 4 hours.';
        var actions = document.createElement('div');
        actions.className = 'dc-wss-actions';
        var save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Save current to cloud';
        save.addEventListener('click', saveCurrentStateToCloud);
        var refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.textContent = 'Refresh cloud list';
        refresh.addEventListener('click', refreshCloudRows);
        actions.appendChild(save);
        actions.appendChild(refresh);
        cloudRowsHost = document.createElement('div');
        cloudRowsHost.className = 'dc-wss-cloud-rows';
        body.appendChild(note);
        body.appendChild(actions);
        body.appendChild(cloudRowsHost);
        panel.appendChild(head);
        panel.appendChild(body);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        refreshCloudRows();
    }

    function expiresAtFor(ts) {
        var base = Date.parse(ts || '');
        if (!Number.isFinite(base)) {
            base = Date.now();
        }
        return new Date(base + STATE_TTL_MS).toISOString();
    }

    function isExpiredState(state) {
        if (!state || typeof state !== 'object') {
            return true;
        }
        var exp = Date.parse(state.expiresAt || '');
        if (!Number.isFinite(exp)) {
            var saved = Date.parse(state.updatedAt || state.capturedAt || '');
            if (!Number.isFinite(saved)) {
                return false;
            }
            exp = saved + STATE_TTL_MS;
        }
        return Date.now() >= exp;
    }

    function pruneStateStore(store) {
        if (!store || !Array.isArray(store.states)) {
            return { version: 1, states: [] };
        }
        var next = [];
        var changed = false;
        var i;
        for (i = 0; i < store.states.length; i++) {
            var st = store.states[i];
            if (isExpiredState(st)) {
                changed = true;
                continue;
            }
            if (!st.expiresAt) {
                st.expiresAt = expiresAtFor(st.updatedAt || st.capturedAt);
                changed = true;
            }
            next.push(st);
        }
        store.states = next;
        store._prunedExpired = changed;
        return store;
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
        store = pruneStateStore(store);
        if (store._prunedExpired) {
            delete store._prunedExpired;
            writeStateStore(store);
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

    function formatExpiresLabel(ts) {
        var exp = Date.parse(ts || '');
        if (!Number.isFinite(exp)) {
            return 'expires within 4 hours';
        }
        var ms = exp - Date.now();
        if (ms <= 0) {
            return 'expired';
        }
        var mins = Math.max(1, Math.ceil(ms / 60000));
        if (mins >= 60) {
            var hrs = Math.floor(mins / 60);
            var rem = mins % 60;
            return 'expires in ' + hrs + 'h' + (rem ? ' ' + rem + 'm' : '');
        }
        return 'expires in ' + mins + 'm';
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
            ' button{font:600 14px system-ui,Segoe UI,sans-serif;border:none;border-radius:4px;box-sizing:border-box;' +
            'background:#2c3e50;color:#ecf0f1;padding:0 10px;min-height:36px;max-height:50px;display:inline-flex;' +
            'align-items:center;justify-content:center;cursor:pointer;white-space:nowrap;}' +
            '#' +
            HOST_ID +
            ' button:hover{background:#34495e;}' +
            '#' +
            HOST_ID +
            ' button[data-dc-ws-quick]{background:#6b4a1f;}' +
            '#' +
            HOST_ID +
            ' button[data-dc-ws-state]{background:#244b63;}' +
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
            '] .dc-wss-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-note{font-size:12px;color:#b9c4cf;background:#1b2028;border:1px solid #343f4a;border-radius:6px;padding:8px;}' +
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
            host.appendChild(makeButton('WS state', 'Save or recall local/cloud worksheet states', 'data-dc-ws-state', openStateDialog));
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
                var rowH = Math.max(
                    (row && (row.offsetHeight || row.clientHeight)) || 0,
                    anchor.offsetHeight || 0,
                    anchor.clientHeight || 0
                );
                if (rowH < 24) {
                    rowH = 36;
                }
                rowH = Math.min(rowH, 50);
                host.querySelectorAll('button').forEach(function (b) {
                    b.style.minHeight = rowH + 'px';
                    b.style.height = 'auto';
                    b.style.alignSelf = 'stretch';
                });
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
        state.expiresAt = expiresAtFor(state.updatedAt);
        if (existingIndex >= 0) {
            if (!window.confirm('Replace saved state "' + name + '"?')) {
                return;
            }
            store.states[existingIndex] = state;
        } else {
            store.states.unshift(state);
        }
        if (writeStateStore(store)) {
            toast('Saved "' + name + '" (' + itemSummary(state.items) + '), expires in 4 hours.', false);
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
        cloudRowsHost = null;
        localRowsHost = null;
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
        meta.textContent =
            itemSummary(state.items) +
            ' - saved ' +
            formatDate(state.updatedAt || state.capturedAt) +
            ' - ' +
            formatExpiresLabel(state.expiresAt);
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
            refreshLocalRows();
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


    function refreshLocalRows() {
        if (!localRowsHost) {
            return;
        }
        localRowsHost.textContent = '';
        var store = readStateStore();
        if (!store.states.length) {
            localRowsHost.textContent = 'No local saved states yet.';
            return;
        }
        for (var i = 0; i < store.states.length; i++) {
            localRowsHost.appendChild(buildStateRow(store.states[i]));
        }
    }

    function addSectionTitle(host, text) {
        var title = document.createElement('div');
        title.className = 'dc-wss-name';
        title.textContent = text;
        title.style.marginTop = '4px';
        host.appendChild(title);
    }

    function openStateDialog() {
        closeModal();
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
        title.textContent = 'Worksheet states';
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', closeModal);
        head.appendChild(title);
        head.appendChild(close);

        var body = document.createElement('div');
        body.className = 'dc-wss-body';

        addSectionTitle(body, 'Local states');
        var localNote = document.createElement('div');
        localNote.className = 'dc-wss-note';
        localNote.textContent = 'Local states stay in this browser only and expire after 4 hours.';
        var localActions = document.createElement('div');
        localActions.className = 'dc-wss-actions';
        var saveLocal = document.createElement('button');
        saveLocal.type = 'button';
        saveLocal.textContent = 'Save current locally';
        saveLocal.addEventListener('click', function () {
            saveCurrentState();
            refreshLocalRows();
        });
        localActions.appendChild(saveLocal);
        localRowsHost = document.createElement('div');
        localRowsHost.className = 'dc-wss-local-rows';
        body.appendChild(localNote);
        body.appendChild(localActions);
        body.appendChild(localRowsHost);

        addSectionTitle(body, 'Cloud states');
        var cloudNote = document.createElement('div');
        cloudNote.className = 'dc-wss-note';
        cloudNote.textContent =
            'Current DonkeyCODE folder: ' +
            activeDonkeyCodeFolder() +
            '. Cloud states are shared with all users and expire after 4 hours.';
        var cloudActions = document.createElement('div');
        cloudActions.className = 'dc-wss-actions';
        var saveCloud = document.createElement('button');
        saveCloud.type = 'button';
        saveCloud.textContent = 'Save current to cloud';
        saveCloud.addEventListener('click', saveCurrentStateToCloud);
        var refreshCloud = document.createElement('button');
        refreshCloud.type = 'button';
        refreshCloud.textContent = 'Refresh cloud list';
        refreshCloud.addEventListener('click', refreshCloudRows);
        cloudActions.appendChild(saveCloud);
        cloudActions.appendChild(refreshCloud);
        cloudRowsHost = document.createElement('div');
        cloudRowsHost.className = 'dc-wss-cloud-rows';
        body.appendChild(cloudNote);
        body.appendChild(cloudActions);
        body.appendChild(cloudRowsHost);

        panel.appendChild(head);
        panel.appendChild(body);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        refreshLocalRows();
        refreshCloudRows();
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
        readStateStore();
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
