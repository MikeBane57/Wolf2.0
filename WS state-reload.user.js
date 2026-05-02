// ==UserScript==
// @name         WS state/reload
// @namespace    Wolf 2.0
// @version      0.2.23
// @description  Cloud/sync logs and toolbar debug → extension inspector only (no page console). Quick reload settle.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        GM_xmlhttpRequest
// @connect      *
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @donkeycode-pref {"worksheetStateDataOwner":{"type":"string","group":"Worksheet state — data file","label":"JSON repo owner","description":"If blank: donkeycode_github_owner → MikeBane57. WoF prefs are not used.","default":"","placeholder":""},"worksheetStateDataRepo":{"type":"string","group":"Worksheet state — data file","label":"JSON repo name","description":"If blank: donkeycode_github_repo → DonkeyCODE.","default":"","placeholder":""},"worksheetStateDataBranch":{"type":"string","group":"Worksheet state — data file","label":"JSON branch","description":"If blank: donkeycode_github_branch → main.","default":"","placeholder":""},"worksheetStateRepoPath":{"type":"string","group":"Worksheet state — data file","label":"JSON / folder hint in repo","description":"Legacy: path to a single worksheet-states.json. Empty → WORKSHEET STATES/worksheet-states.json. New cloud saves go under a parallel …/sessions/ folder (index + one file per save; legacy file is still read if no index).","default":"","placeholder":"WORKSHEET STATES/worksheet-states.json"},"worksheetToolbarClickDebug":{"type":"boolean","group":"Worksheet state","label":"Log click target (extension)","description":"When ON: helper-row click diagnostics post to DonkeyCODE service worker (DONKEYCODE_PAGE_LOG), not the page console. Default OFF.","default":false}}
// @donkeycode-pref {"worksheetQuickReloadSettleMs":{"type":"number","group":"Worksheet state","label":"Quick reload: max wait for flights (ms)","description":"Before reload, wait until the captured tail/line count stops growing (so late-loaded aircraft are included) or this max time. Raise if quick reload still misses rows. Default 3200.","default":3200,"min":800,"max":20000}}
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
    var BRIEF_HOST_ID = 'dc-brief-ai-ws-host';
    var STATE_TTL_MS = 4 * 60 * 60 * 1000;
    var GITHUB_OWNER = 'MikeBane57';
    var GITHUB_REPO = 'DonkeyCODE';
    var GITHUB_BRANCH = 'main';
    var CLOUD_FILE_PATH = 'WORKSHEET STATES/worksheet-states.json';

    var mountObserver = null;
    var mountRaf = 0;
    var restoreTimer = null;
    var onToolbarClickDebug = null;
    var activeApplyTimer = null;
    var cloudRowsHost = null;
    var localRowsHost = null;
    /** Live reference to the scrollable <pre> in the open Load/Cloud modal (for WoF-style debug log). */
    var wsCloudLogPre = null;
    var WS_CLOUD_LOG_ID = 'dc-ws-cloud-sync-log';
    /** Load WS modal: note elements updated on each cloud refresh so folder changes without re-open. */
    var loadFolderBannerLine = null;

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

    /** Page → DonkeyCODE extension service worker (not the site DevTools console). */
    function donkeycodePageLog(message, level) {
        var s = String(message == null ? '' : message);
        var lv = level || 'log';
        if (typeof window !== 'undefined' && window.top) {
            try {
                window.top.postMessage(
                    { type: 'DONKEYCODE_PAGE_LOG', message: s, level: lv },
                    '*'
                );
            } catch (e) {}
        }
    }

    /**
     * Which DonkeyCODE pref key last supplied the session folder (debug / Load WS line).
     * 'legacy' = legacy key list. '' = __default__ / no value.
     */
    var lastSessionFolderPrefKey = '';

    function getPrefRaw(key) {
        if (typeof donkeycodeGetPref !== 'function' || !key) {
            return null;
        }
        try {
            return donkeycodeGetPref(key);
        } catch (e) {
            return null;
        }
    }

    /**
     * DonkeyCODE may expose a string, JSON, or a plain object with name/path/folder/…
     */
    function extractFolderStringFromDonkeycodeValue(maybe) {
        if (maybe == null) {
            return '';
        }
        if (typeof maybe === 'object' && !Array.isArray(maybe) && maybe !== null) {
            var pickO =
                maybe.name ||
                maybe.path ||
                maybe.folder ||
                maybe.folderName ||
                maybe.key ||
                maybe.id ||
                maybe.slug ||
                maybe.label ||
                maybe.sessionFolder ||
                maybe.session;
            if (pickO != null) {
                var t = trimText(String(pickO));
                if (t) {
                    return t;
                }
            }
        }
        var s = typeof maybe === 'string' ? maybe : JSON.stringify(maybe);
        s = trimText(s);
        if (!s) {
            return '';
        }
        if (s === '__default__' || s.toLowerCase() === 'default') {
            return s === '__default__' ? '__default__' : 'default';
        }
        if (s.charAt(0) === '{' || s.charAt(0) === '[') {
            var o = safeJsonParse(s, null);
            if (o && typeof o === 'object' && !Array.isArray(o)) {
                return extractFolderStringFromDonkeycodeValue(o);
            }
        }
        return s;
    }

    function globalDonkeycodeSessionFolder() {
        var g;
        try {
            g = typeof globalThis !== 'undefined' ? globalThis : window;
        } catch (e) {
            g = window;
        }
        if (!g) {
            return '';
        }
        if (typeof g.donkeycodeGetCurrentSessionFolder === 'function') {
            try {
                var v = g.donkeycodeGetCurrentSessionFolder();
                var s = extractFolderStringFromDonkeycodeValue(v);
                s = trimText(String(s == null ? '' : s));
                if (s) {
                    lastSessionFolderPrefKey = 'donkeycodeGetCurrentSessionFolder()';
                    return s;
                }
            } catch (e2) {}
        }
        if (g.donkeycodeCurrentSessionFolder != null && g.donkeycodeCurrentSessionFolder !== '') {
            var s2 = extractFolderStringFromDonkeycodeValue(g.donkeycodeCurrentSessionFolder);
            s2 = trimText(String(s2 == null ? '' : s2));
            if (s2) {
                lastSessionFolderPrefKey = 'window.donkeycodeCurrentSessionFolder';
                return s2;
            }
        }
        return '';
    }

    /**
     * Live session folder: DonkeyCODE runtime first (getCurrentSessionFolder / global), then merged prefs.
     * Order matters: @donkeycode-pref fixed values override runtime injection — do not put current session in schema.
     * Re-read every time; no top-level cache.
     */
    function donkeycodeCurrentSessionFolderRaw() {
        lastSessionFolderPrefKey = '';
        var fromGlobal = globalDonkeycodeSessionFolder();
        if (fromGlobal) {
            return fromGlobal;
        }
        var tryKeys = [
            'donkeycode_current_session_folder',
            'donkeycode_active_session_folder',
            'donkeycode_session_folder',
            'donkeycode_session_folder_key',
            'donkeycode_active_session_key',
            'donkeycode_session_key',
            'donkeycode_active_session',
            'donkeycode_current_session',
            'donkeycode_current_session_id'
        ];
        var i;
        for (i = 0; i < tryKeys.length; i++) {
            var k = tryKeys[i];
            var v = getPrefRaw(k);
            if (v === undefined || v === null || (typeof v === 'string' && v === '')) {
                continue;
            }
            var ex = extractFolderStringFromDonkeycodeValue(v);
            ex = trimText(String(ex == null ? '' : ex));
            if (ex) {
                lastSessionFolderPrefKey = k;
                return ex;
            }
        }
        return '';
    }

    function resolvedGithubPat() {
        return trimText(getPref('donkeycode_github_pat', ''));
    }

    /**
     * Repo for worksheet-states.json: worksheet state prefs, then donkeycode_github_* (no Wall of Fame fallbacks).
     */
    function resolvedCloudOwner() {
        return (
            trimText(getPref('worksheetStateDataOwner', '')) ||
            trimText(getPref('donkeycode_github_owner', '')) ||
            GITHUB_OWNER
        );
    }

    function resolvedCloudRepo() {
        return (
            trimText(getPref('worksheetStateDataRepo', '')) ||
            trimText(getPref('donkeycode_github_repo', '')) ||
            GITHUB_REPO
        );
    }

    function resolvedCloudBranch() {
        return (
            trimText(getPref('worksheetStateDataBranch', '')) ||
            trimText(getPref('donkeycode_github_branch', '')) ||
            GITHUB_BRANCH
        );
    }

    function resolvedCloudPath() {
        return (trimText(getPref('worksheetStateRepoPath', '')) || CLOUD_FILE_PATH).replace(/^\/+/, '');
    }

    /**
     * Sharded storage: one small JSON per save under …/sessions/; index.json lists them.
     * `worksheetStateRepoPath` still points at the legacy file (e.g. …/worksheet-states.json); we derive …/sessions from its directory.
     */
    function cloudStorageDir() {
        var p = trimText(resolvedCloudPath() || '') || CLOUD_FILE_PATH;
        p = p.replace(/\\/g, '/');
        if (/\.json$/i.test(p)) {
            return p.replace(/\/[^/]+$/, '/sessions') || 'WORKSHEET STATES/sessions';
        }
        var d = p.replace(/\/+$/, '');
        if (!d) {
            d = 'WORKSHEET STATES';
        }
        return d + '/sessions';
    }

    function indexJsonPath() {
        return cloudStorageDir() + '/index.json';
    }

    function stateJsonPathForId(id) {
        return cloudStorageDir() + '/state-' + trimText(String(id == null ? '' : id)) + '.json';
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

    function rawUrlForPath(relPath) {
        return (
            'https://raw.githubusercontent.com/' +
            encodeURIComponent(resolvedCloudOwner()) +
            '/' +
            encodeURIComponent(resolvedCloudRepo()) +
            '/' +
            encodeURIComponent(resolvedCloudBranch()) +
            '/' +
            encodedRepoPath(relPath)
        );
    }

    function rawCloudUrl() {
        return rawUrlForPath(resolvedCloudPath());
    }

    function githubContentsApiUrlForPath(relPath) {
        return (
            'https://api.github.com/repos/' +
            encodeURIComponent(resolvedCloudOwner()) +
            '/' +
            encodeURIComponent(resolvedCloudRepo()) +
            '/contents/' +
            encodedRepoPath(relPath)
        );
    }

    function githubContentsApiUrl() {
        return githubContentsApiUrlForPath(resolvedCloudPath());
    }

    function legacySessionFolderFromPrefs() {
        var keys = [
            'donkeycode_current_folder',
            'donkeycode_folder',
            'donkeycode_session_name',
            'donkeycode_active_session_name',
            'donkeycode_active_tab_folder',
            'donkeycode_session'
        ];
        var i;
        for (i = 0; i < keys.length; i++) {
            var v = getPrefRaw(keys[i]);
            if (v === undefined || v === null) {
                continue;
            }
            var t = extractFolderStringFromDonkeycodeValue(v);
            t = trimText(String(t == null ? '' : t));
            if (!t) {
                continue;
            }
            t = t.replace(/^\/+|\/+$/g, '');
            if (!t) {
                continue;
            }
            if (/[\\/]/.test(t) && (t.indexOf('github') >= 0 || t.indexOf('.com') >= 0 || t.split('/').length > 2)) {
                var seg = t.split(/[\\/]+/).filter(Boolean);
                t = seg[seg.length - 1] || t;
            }
            return t || 'Default';
        }
        return '';
    }

    /**
     * Canonical folder key for storage and equality (cloud/local). __default__ = built-in Default folder.
     * Legacy "Default" / "default" maps to __default__.
     */
    function sessionFolderKeyCanonical() {
        var r = trimText(donkeycodeCurrentSessionFolderRaw());
        if (r) {
            if (r === '__default__' || r.toLowerCase() === 'default') {
                return '__default__';
            }
            return r;
        }
        var leg = trimText(legacySessionFolderFromPrefs());
        if (leg) {
            lastSessionFolderPrefKey = 'legacy';
        }
        if (!leg || leg === 'Default') {
            if (!leg) {
                lastSessionFolderPrefKey = '';
            }
            return '__default__';
        }
        return leg;
    }

    function updateLoadFolderBanner() {
        if (!loadFolderBannerLine) {
            return;
        }
        donkeycodeCurrentSessionFolderRaw();
        var fk = sessionFolderKeyCanonical();
        var label = sessionFolderDisplayLabel(fk);
        var detail = fk !== '__default__' ? ' (' + fk + ')' : '';
        loadFolderBannerLine.textContent = 'Folder: ' + label + detail;
    }

    /** User-visible label: "Default" for __default__, else the key (e.g. ops/team1). */
    function sessionFolderDisplayLabel(keyOrCanonical) {
        var k = trimText(String(keyOrCanonical == null ? '' : keyOrCanonical));
        if (!k) {
            return 'Default';
        }
        if (k === '__default__' || k === 'Default' || k.toLowerCase() === 'default') {
            return 'Default';
        }
        return k;
    }

    /**
     * @deprecated use sessionFolderDisplayLabel(sessionFolderKeyCanonical()) for UI; key for save/compare.
     * Kept for existing call sites: returns display label of active session.
     */
    function activeDonkeyCodeFolder() {
        return sessionFolderDisplayLabel(sessionFolderKeyCanonical());
    }

    function normalizeSessionFolderKey(s) {
        var t = trimText(String(s == null ? '' : s));
        if (!t) {
            return '__default__';
        }
        if (t === '__default__' || t === 'Default' || t.toLowerCase() === 'default') {
            return '__default__';
        }
        return t;
    }

    function normalizeFolderForCompare(s) {
        return String(normalizeSessionFolderKey(s)).toLowerCase();
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

    function utf8ToBase64(str) {
        return btoa(unescape(encodeURIComponent(String(str == null ? '' : str))));
    }


    function normalizeCloudState(state) {
        if (!state || typeof state !== 'object' || !Array.isArray(state.items) || !state.items.length) {
            return null;
        }
        var savedAt = trimText(state.savedAt || state.updatedAt || state.capturedAt || nowIso());
        var folder = normalizeSessionFolderKey(state.folder || state.sessionFolder || state.folderName);
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
            cb(0, 'GM_xmlhttpRequest unavailable (Tampermonkey/DonkeyCODE).');
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
                cb(0, 'Network error (check @connect api.github.com, VPN, or extension HTTP access).');
            }
        });
    }

    function githubApiErrorSummary(status, body) {
        var t = String(body || '').trim();
        var o = safeJsonParse(t, null);
        if (o && typeof o.message === 'string' && o.message) {
            var s = o.message;
            if (o.errors && o.errors[0] && o.errors[0].message) {
                s += ' — ' + o.errors[0].message;
            }
            return s;
        }
        if (t && t.length < 400) {
            return t;
        }
        return t ? t.slice(0, 200) : '';
    }

    function appendCloudSyncLog(msg) {
        var line =
            '[' + new Date().toISOString().replace('T', ' ').slice(0, 23) + '] ' + String(msg == null ? '' : msg);
        donkeycodePageLog('[WS State][cloud] ' + String(msg == null ? '' : msg));
        var el = wsCloudLogPre;
        if (!el) {
            return;
        }
        el.textContent = (el.textContent ? el.textContent + '\n' : '') + line;
        el.scrollTop = el.scrollHeight;
    }

    function clearCloudSyncLog() {
        if (wsCloudLogPre) {
            wsCloudLogPre.textContent = '';
        }
    }

    function createCloudSyncLogSection(headingText) {
        var deets = document.createElement('details');
        deets.setAttribute('data-dc-ws-cloud-log-details', '1');
        deets.style.cssText = 'flex-shrink:0;margin-top:4px;';
        var sum = document.createElement('summary');
        sum.textContent = headingText || 'Cloud sync debug log';
        sum.title = 'Expand to view cloud sync log (GET/PUT Contents API)';
        sum.style.cssText = 'cursor:pointer;user-select:none;font-size:12px;font-weight:600;color:#5dade2;';
        var inner = document.createElement('div');
        inner.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px 0 0;';
        var sub = document.createElement('div');
        sub.textContent = 'Timestamps are UTC. Copy the log if you need support.';
        sub.style.cssText = 'font-size:10px;color:#7f8c8d;';
        var act = document.createElement('div');
        act.className = 'dc-wss-actions';
        act.style.marginBottom = '0';
        var btnClear = document.createElement('button');
        btnClear.type = 'button';
        btnClear.textContent = 'Clear log';
        btnClear.addEventListener('click', function (ev) {
            ev.stopPropagation();
            try {
                deets.open = true;
            } catch (e) {}
            clearCloudSyncLog();
        });
        var btnCopy = document.createElement('button');
        btnCopy.type = 'button';
        btnCopy.textContent = 'Copy log';
        btnCopy.addEventListener('click', function (ev) {
            ev.stopPropagation();
            try {
                deets.open = true;
            } catch (e) {}
            var t = wsCloudLogPre ? String(wsCloudLogPre.textContent || '') : '';
            if (!t) {
                return;
            }
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(t);
                    toast('Log copied to clipboard.', false);
                } else {
                    var ta = document.createElement('textarea');
                    ta.value = t;
                    ta.style.cssText = 'position:fixed;left:-9999px;';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    toast('Log copied to clipboard.', false);
                }
            } catch (e) {
                toast('Could not copy (browser blocked).', true);
            }
        });
        act.appendChild(btnClear);
        act.appendChild(btnCopy);
        var pre = document.createElement('pre');
        pre.id = WS_CLOUD_LOG_ID;
        pre.setAttribute('aria-label', 'Worksheet state cloud sync debug log');
        pre.style.cssText =
            'width:100%;min-height:72px;max-height:140px;overflow:auto;margin:0;padding:8px;' +
            'font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;white-space:pre-wrap;word-break:break-word;' +
            'background:#151820;border:1px solid #343f4a;border-radius:6px;color:#b8c9dc;box-sizing:border-box;';
        wsCloudLogPre = pre;
        deets.appendChild(sum);
        inner.appendChild(sub);
        inner.appendChild(act);
        inner.appendChild(pre);
        deets.appendChild(inner);
        return deets;
    }

    function rawGithubGetPath(relPath, cb) {
        var rawUrl = rawUrlForPath(relPath);
        appendCloudSyncLog('GET (raw) ' + rawUrl);
        gmXhr('GET', rawUrl, { Accept: 'application/json' }, null, function (status, text) {
            if (status === 404) {
                if (resolvedGithubPat()) {
                    appendCloudSyncLog(
                        'raw GET: HTTP 404 — not served from raw (private repo, or file not on CDN). Trying Contents API with PAT…'
                    );
                    cb(null, null);
                } else {
                    appendCloudSyncLog('raw GET: HTTP 404 (no public file at this path) — using empty document.');
                    cb('{"states":[]}', null);
                }
                return;
            }
            if (status < 200 || status >= 300) {
                if (!status) {
                    var err0 =
                        'raw.githubusercontent.com: ' +
                        (githubApiErrorSummary(0, text) || 'request failed (private repo needs PAT for API fallback).');
                    appendCloudSyncLog('raw GET failed: ' + err0);
                    cb(null, err0);
                    return;
                }
                var err1 =
                    'raw.githubusercontent.com HTTP ' +
                    status +
                    (text ? ' — ' + githubApiErrorSummary(status, text) : ' (is the repo public, or is donkeycode_github_pat set for private read?)');
                appendCloudSyncLog('raw GET failed: ' + err1);
                cb(null, err1);
                return;
            }
            appendCloudSyncLog('raw GET: OK, parsing JSON…');
            cb(text || '', null);
        });
    }

    function rawGithubGetCloud(cb) {
        rawGithubGetPath(resolvedCloudPath(), function (text, rawErr) {
            if (rawErr) {
                cb(null, rawErr, null);
                return;
            }
            if (text == null) {
                appendCloudSyncLog('raw: no body (treat as empty legacy document).');
                cb(cloudDocFor([]), null, null);
                return;
            }
            cb(parseCloudDocument(text || '{"states":[]}'), null, null);
        });
    }

    function githubGetJsonPath(relPath, cb) {
        if (!resolvedGithubPat()) {
            var e =
                'Set donkeycode_github_pat in DonkeyCODE: needed to read a private ' +
                resolvedCloudOwner() +
                '/' +
                resolvedCloudRepo() +
                ' file, or to confirm path exists.';
            appendCloudSyncLog('GET /contents/ skipped: no PAT. ' + e);
            cb(null, e, null);
            return;
        }
        var cUrl = githubContentsApiUrlForPath(relPath) + '?ref=' + encodeURIComponent(resolvedCloudBranch());
        appendCloudSyncLog('GET (Contents API) ' + cUrl);
        gmXhr('GET', cUrl, githubApiHeaders(), null, function (status, text) {
            if (status === 404) {
                appendCloudSyncLog('GET /contents/: HTTP 404 (no file) — ' + relPath);
                cb(null, null);
                return;
            }
            if (status < 200 || status >= 300) {
                var err2 =
                    'GET /contents/' + relPath + ' HTTP ' + status + ' — ' + githubApiErrorSummary(status, text);
                appendCloudSyncLog('GET /contents/ failed: ' + err2);
                cb(null, err2);
                return;
            }
            var meta = safeJsonParse(text, null);
            if (!meta) {
                appendCloudSyncLog('GET /contents/: could not parse metadata JSON — ' + relPath);
                cb(null, 'Contents API: could not parse file metadata JSON.');
                return;
            }
            var fsha = meta && meta.sha ? String(meta.sha) : null;
            appendCloudSyncLog('GET /contents/: OK, file sha: ' + (fsha ? fsha.slice(0, 7) + '…' : '(none)') + ' — ' + relPath);
            /** Second return value: SHA string when present (for call sites that need it; optional). */
            var decoded = decodeGithubFileContent(meta.content || '');
            cb([decoded, fsha], null);
        });
    }

    function githubGetCloud(cb) {
        githubGetJsonPath(resolvedCloudPath(), function (res, apiErr) {
            if (apiErr) {
                cb(null, apiErr, null);
                return;
            }
            if (!res || res[0] == null) {
                appendCloudSyncLog('GET /contents/: HTTP 404 (no file yet) — using empty document.');
                cb(cloudDocFor([]), null, null);
                return;
            }
            appendCloudSyncLog('GET /contents/: decoded blob, parsing document…');
            cb(parseCloudDocument(res[0]), null, res[1] != null ? res[1] : null);
        });
    }

    function parseIndexDocument(text) {
        var doc = safeJsonParse(text, null);
        if (!doc || typeof doc !== 'object') {
            return { version: 1, stateIds: [], updatedAt: 0, format: 'worksheet-states-shard' };
        }
        var ids = Array.isArray(doc.stateIds) ? doc.stateIds.map(function (x) { return trimText(String(x)); }) : [];
        return {
            version: doc.version || 1,
            stateIds: ids.filter(Boolean),
            updatedAt: doc.updatedAt != null ? doc.updatedAt : 0,
            format: 'worksheet-states-shard'
        };
    }

    function mergeStateListsIntoDoc(baseDoc, moreStates) {
        var seen = {};
        var out = [];
        var j;
        var st;
        var arr = (moreStates || []).concat(baseDoc.states || []);
        for (j = 0; j < arr.length; j++) {
            st = arr[j];
            if (!st || !st.id) {
                continue;
            }
            var id = String(st.id);
            if (seen[id]) {
                continue;
            }
            seen[id] = true;
            st = normalizeCloudState(st);
            if (st && !isExpiredState(st)) {
                out.push(st);
            }
        }
        return { version: 1, states: out, updatedAt: Date.now() };
    }

    function loadStatesFromIndexShard(ids, fromIdx, outStates, onDone) {
        if (fromIdx >= ids.length) {
            onDone(outStates);
            return;
        }
        var id = ids[fromIdx];
        if (!id) {
            loadStatesFromIndexShard(ids, fromIdx + 1, outStates, onDone);
            return;
        }
        var path = stateJsonPathForId(id);
        githubGetJsonPath(path, function (res, err) {
            if (err) {
                appendCloudSyncLog('State file GET failed: ' + path + ' — ' + err);
                loadStatesFromIndexShard(ids, fromIdx + 1, outStates, onDone);
                return;
            }
            var blob = res && res[0];
            if (blob == null) {
                appendCloudSyncLog('State file missing (skipping id): ' + path);
                loadStatesFromIndexShard(ids, fromIdx + 1, outStates, onDone);
                return;
            }
            var one = safeJsonParse(String(blob), null);
            if (!one) {
                loadStatesFromIndexShard(ids, fromIdx + 1, outStates, onDone);
                return;
            }
            /** Per-file save format: { state: { id, name, items, ... } } — not top-level items. */
            if (one.state && typeof one.state === 'object' && Array.isArray(one.state.items)) {
                one = one.state;
            } else if (one.states && one.states[0]) {
                one = one.states[0];
            }
            var n = normalizeCloudState(one);
            if (n && !isExpiredState(n)) {
                outStates.push(n);
            }
            loadStatesFromIndexShard(ids, fromIdx + 1, outStates, onDone);
        });
    }

    function fetchCloudStatesWithIndexThenLegacy(cb) {
        var idxPath = indexJsonPath();
        var usePat = resolvedGithubPat();
        function loadLegacy(mergeWith) {
            var prior = mergeWith && mergeWith.states && mergeWith.states.length ? mergeWith : null;
            rawGithubGetCloud(function (doc, rawErr) {
                if (doc) {
                    var m = prior ? mergeStateListsIntoDoc(doc, prior.states) : doc;
                    var n0 = (m.states && m.states.length) || 0;
                    appendCloudSyncLog('Load OK (raw legacy ' + resolvedCloudPath() + '): ' + n0 + ' state(s).');
                    cb(m, null, null);
                    return;
                }
                appendCloudSyncLog('Falling back to GitHub Contents API (private repo or raw failed)…');
                githubGetCloud(function (doc2, apiErr) {
                    if (doc2) {
                        var m2 = prior ? mergeStateListsIntoDoc(doc2, prior.states) : doc2;
                        var n2 = (m2.states && m2.states.length) || 0;
                        appendCloudSyncLog('Load OK (Contents API legacy): ' + n2 + ' state(s).');
                        cb(m2, null, null);
                        return;
                    }
                    if (prior) {
                        appendCloudSyncLog('Legacy load failed but we have sharded data: ' + (apiErr || rawErr || 'unknown'));
                        cb(prior, null, null);
                        return;
                    }
                    var err = apiErr || rawErr || 'Could not load cloud JSON (check prefs, donkeycode_github_*, and path).';
                    appendCloudSyncLog('Load failed: ' + err);
                    cb(null, err, null);
                });
            });
        }
        if (usePat) {
            appendCloudSyncLog('Cloud index: GET (Contents API) ' + idxPath);
            githubGetJsonPath(idxPath, function (res) {
                var idxBody = res && res[0];
                if (idxBody) {
                    var ind = parseIndexDocument(idxBody);
                    if (ind.stateIds && ind.stateIds.length) {
                        appendCloudSyncLog('Index: ' + ind.stateIds.length + ' state file(s) under ' + cloudStorageDir());
                        loadStatesFromIndexShard(ind.stateIds, 0, [], function (sharded) {
                            var part = cloudDocFor(sharded);
                            loadLegacy(part);
                        });
                        return;
                    }
                }
                loadLegacy(null);
            });
            return;
        }
        rawGithubGetPath(idxPath, function (text) {
            if (text) {
                var ind2 = parseIndexDocument(text);
                if (ind2.stateIds && ind2.stateIds.length) {
                    appendCloudSyncLog('Index (raw) lists ' + ind2.stateIds.length + ' file(s) — set PAT to load sharded state bodies from private repo.');
                }
            }
            loadLegacy(null);
        });
    }

    function fetchCloudStates(cb) {
        var dir = cloudStorageDir();
        appendCloudSyncLog(
            'Cloud: GitHub REST — dir ' + dir + ' (index + per-state files); legacy ' + resolvedCloudPath() + ' | repo ' +
                resolvedCloudOwner() +
                '/' +
                resolvedCloudRepo() +
                '@' +
                resolvedCloudBranch()
        );
        if (!resolvedGithubPat()) {
            appendCloudSyncLog('Set donkeycode_github_pat to load sharded state files; raw may only show legacy single JSON.');
        }
        fetchCloudStatesWithIndexThenLegacy(cb);
    }

    function getContentsMetadataForPathPut(relPath, cb) {
        if (!resolvedGithubPat()) {
            cb(null, 'No PAT for GET /contents/');
            return;
        }
        var cUrl = githubContentsApiUrlForPath(relPath) + '?ref=' + encodeURIComponent(resolvedCloudBranch());
        appendCloudSyncLog('PUT prep: GET metadata + SHA ' + cUrl);
        gmXhr('GET', cUrl, githubApiHeaders(), null, function (status, text) {
            if (status === 404) {
                appendCloudSyncLog('PUT prep: file absent (HTTP 404) — will create on PUT without sha. Path: ' + relPath);
                cb({ sha: null }, null);
                return;
            }
            if (status < 200 || status >= 300) {
                var e = 'GET (for sha) HTTP ' + status + ' — ' + githubApiErrorSummary(status, text);
                appendCloudSyncLog('PUT prep failed: ' + e);
                cb(null, e);
                return;
            }
            var meta = safeJsonParse(text, null);
            if (!meta) {
                cb(null, 'Could not parse file metadata for PUT');
                return;
            }
            cb({ sha: meta.sha ? String(meta.sha) : null }, null);
        });
    }

    /**
     * Direct Contents API PUT to `relPath` in the repo. Always refetches SHA before each attempt; 409 retry.
     */
    function putJsonAtCloudPath(relPath, jsonObj, commitMessage, cb) {
        if (!resolvedGithubPat()) {
            var perr =
                'Direct mode: set donkeycode_github_pat with Contents read/write for repo ' +
                resolvedCloudOwner() +
                '/' +
                resolvedCloudRepo() +
                '.';
            appendCloudSyncLog('PUT aborted: ' + perr);
            cb(false, perr);
            return;
        }
        var branch = resolvedCloudBranch();
        var path = relPath;
        var jsonStr = JSON.stringify(jsonObj, null, 2) + '\n';
        var max409 = 5;
        var att = 0;
        var baseMsg = commitMessage || 'Worksheet state: update (DonkeyCODE API)';
        function doPutWithFreshSha() {
            getContentsMetadataForPathPut(path, function (m, err) {
                if (err) {
                    appendCloudSyncLog('PUT: could not get file SHA: ' + err);
                    cb(false, err);
                    return;
                }
                var sha = m && m.sha ? String(m.sha) : null;
                var body = {
                    message: att > 0 ? baseMsg + ' (retry ' + att + ' after 409)' : baseMsg,
                    content: utf8ToBase64(jsonStr),
                    branch: branch
                };
                if (sha) {
                    body.sha = sha;
                }
                var url = githubContentsApiUrlForPath(path);
                appendCloudSyncLog(
                    'PUT Contents ' +
                        path +
                        (sha ? ' (sha ' + String(sha).slice(0, 7) + '…' : ' (new file)') +
                        ' on ' +
                        branch
                );
                var headers = githubApiHeaders();
                headers['Content-Type'] = 'application/json';
                gmXhr('PUT', url, headers, body, function (status, text) {
                    if (status === 200 || status === 201) {
                        appendCloudSyncLog('PUT succeeded: HTTP ' + status);
                        cb(true, null);
                        return;
                    }
                    if (status === 409) {
                        att += 1;
                        if (att < max409) {
                            appendCloudSyncLog('PUT HTTP 409 — ' + path + ' changed. Refetching SHA, retry ' + att + '/' + (max409 - 1) + '…');
                            setTimeout(function () {
                                doPutWithFreshSha();
                            }, 120);
                            return;
                        }
                    }
                    var detail = githubApiErrorSummary(status, text);
                    var msg = 'PUT failed: HTTP ' + status + (detail ? ' — ' + detail : '');
                    if (status === 409) {
                        msg += ' (still conflicting after ' + (max409 - 1) + ' retries; save again in a few seconds if needed.)';
                    }
                    appendCloudSyncLog(msg);
                    cb(false, msg);
                });
            });
        }
        appendCloudSyncLog('PUT: fresh SHAs for each attempt — ' + path);
        doPutWithFreshSha();
    }

    function putCloudDocumentDirect(finalDoc, knownSha, cb) {
        putJsonAtCloudPath(
            resolvedCloudPath(),
            finalDoc,
            'Worksheet states: sync legacy file (DonkeyCODE API)',
            cb
        );
    }

    function postCloudAfterMerge(mergedDoc, fileSha, cb) {
        putCloudDocumentDirect(cloudDocFor((mergedDoc && mergedDoc.states) || []), fileSha, cb);
    }

    function deleteFileAtCloudPath(relPath, cb) {
        if (!resolvedGithubPat()) {
            cb(false, 'No PAT for delete');
            return;
        }
        getContentsMetadataForPathPut(relPath, function (m, err) {
            if (err) {
                cb(false, err);
                return;
            }
            if (!m || m.sha == null) {
                appendCloudSyncLog('Delete: file absent, skip — ' + relPath);
                cb(true, null);
                return;
            }
            var sha = String(m.sha);
            var delUrl = githubContentsApiUrlForPath(relPath);
            var body = {
                message: 'Worksheet state: remove ' + relPath,
                sha: sha,
                branch: resolvedCloudBranch()
            };
            appendCloudSyncLog('DELETE Contents ' + relPath);
            var headers = githubApiHeaders();
            headers['Content-Type'] = 'application/json';
            gmXhr('DELETE', delUrl, headers, body, function (st, text) {
                if (st === 200) {
                    appendCloudSyncLog('DELETE OK: HTTP 200 ' + relPath);
                    cb(true, null);
                    return;
                }
                if (st === 404) {
                    appendCloudSyncLog('DELETE: already gone (404) ' + relPath);
                    cb(true, null);
                    return;
                }
                cb(false, 'DELETE failed HTTP ' + st + ' — ' + githubApiErrorSummary(st, text));
            });
        });
    }

    function readCloudIndexForUpdate(cb) {
        if (!resolvedGithubPat()) {
            cb(null, null, 'No PAT');
            return;
        }
        var idxP = indexJsonPath();
        githubGetJsonPath(idxP, function (res, err) {
            if (err) {
                cb(null, null, err);
                return;
            }
            var text = res && res[0];
            if (text == null || text === '') {
                cb(
                    { version: 1, stateIds: [], format: 'worksheet-states-shard', updatedAt: 0 },
                    {},
                    null
                );
                return;
            }
            var ind = parseIndexDocument(String(text));
            var seen = {};
            var k;
            for (k = 0; k < ind.stateIds.length; k++) {
                seen[trimText(String(ind.stateIds[k]))] = true;
            }
            cb(ind, seen, null);
        });
    }

    function saveStateToCloud(state, name, cb) {
        if (!state || !state.items || !state.items.length) {
            toast('No visible tails or N/A line numbers found to save to cloud.', true);
            if (cb) {
                cb(false);
            }
            return;
        }
        /** Re-read DonkeyCODE session folder on every save (not cached at modal open). */
        donkeycodeCurrentSessionFolderRaw();
        if (name == null) {
            name = defaultSaveLabelFromState(state);
        }
        name = trimText(name);
        if (!name) {
            name = defaultSaveLabelFromState(state);
        }
        var folderKey = sessionFolderKeyCanonical();
        var folderLabel = sessionFolderDisplayLabel(folderKey);
        state.id = stateId();
        state.name = name;
        state.folder = folderKey;
        state.savedAt = nowIso();
        state.updatedAt = state.savedAt;
        state.expiresAt = expiresAtFor(state.savedAt);
        var norm = normalizeCloudState(state);
        if (!norm) {
            toast('Could not normalize state for cloud.', true);
            if (cb) {
                cb(false);
            }
            return;
        }
        toast('Saving to cloud...', false);
        appendCloudSyncLog(
            'saveStateToCloud: name="' + name + '", id=' + norm.id + ', folder=' + folderKey + ' (' + folderLabel + '), items=' + norm.items.length
        );
        appendCloudSyncLog('saveStateToCloud: ' + (resolvedGithubPat() ? 'PAT set' : 'PAT missing') + ' — shard dir ' + cloudStorageDir());
        if (!resolvedGithubPat()) {
            var needPat =
                'To save, set donkeycode_github_pat (Contents R/W) for ' + resolvedCloudOwner() + '/' + resolvedCloudRepo() + '.';
            appendCloudSyncLog('saveStateToCloud ABORT: ' + needPat);
            toast(needPat, true);
            if (cb) {
                cb(false);
            }
            return;
        }
        readCloudIndexForUpdate(function (indObj, seen, idxErr) {
            if (idxErr) {
                appendCloudSyncLog('Index read: ' + idxErr + ' (treating as empty index)');
            }
            if (!indObj) {
                indObj = { version: 1, stateIds: [], format: 'worksheet-states-shard', updatedAt: 0 };
            }
            if (!seen) {
                seen = {};
            }
            var idStr = String(norm.id);
            var nextIds = indObj.stateIds ? indObj.stateIds.slice() : [];
            if (seen && seen[idStr] === true) {
            } else {
                nextIds.unshift(idStr);
            }
            if (!seen) {
                seen = {};
            }
            seen[idStr] = true;
            var newIndex = {
                version: 1,
                format: 'worksheet-states-shard',
                stateIds: nextIds.filter(function (x, j, a) {
                    return x && a.indexOf(x) === j;
                }),
                updatedAt: Date.now()
            };
            var oneFile = { version: 1, state: norm, updatedAt: Date.now() };
            var statePath = stateJsonPathForId(idStr);
            appendCloudSyncLog('Sharded save: PUT ' + statePath + ' then ' + indexJsonPath());
            putJsonAtCloudPath(
                statePath,
                oneFile,
                'Worksheet state: ' + name,
                function (ok1, err1) {
                if (!ok1) {
                    toast(err1 || 'Cloud save failed (state file).', true);
                    if (cb) {
                        cb(false);
                    }
                    return;
                }
                putJsonAtCloudPath(
                    indexJsonPath(),
                    newIndex,
                    'Worksheet state index: add ' + idStr,
                    function (ok2, err2) {
                    if (!ok2) {
                        appendCloudSyncLog('WARNING: state file saved but index update failed: ' + (err2 || ''));
                        toast(err2 || 'Saved state file but index update failed — refresh the list or retry.', true);
                        if (cb) {
                            cb(false);
                        }
                        return;
                    }
                    toast('Saved to cloud: "' + name + '" @ ' + statePath, false);
                    refreshCloudRows();
                    if (cb) {
                        cb(true);
                    }
                }
                );
            }
            );
        });
    }

    /**
     * Remove one state: sharded path = DELETE state file + update index; else legacy single JSON.
     */
    function deleteCloudStateById(stateId, nameHint) {
        var sid = trimText(String(stateId == null ? '' : stateId));
        if (!sid) {
            toast('Cannot delete: this cloud entry has no id.', true);
            return;
        }
        var label = trimText(String(nameHint || '')) || sid;
        donkeycodeCurrentSessionFolderRaw();
        toast('Removing from cloud...', false);
        appendCloudSyncLog('deleteCloudStateById: id="' + sid + '", label="' + label + '"');
        if (!resolvedGithubPat()) {
            var needPatD =
                'To delete, set donkeycode_github_pat (Contents R/W) for ' + resolvedCloudOwner() + '/' + resolvedCloudRepo() + '.';
            appendCloudSyncLog('deleteCloudStateById ABORT: ' + needPatD);
            toast(needPatD, true);
            return;
        }
        readCloudIndexForUpdate(function (indObj, seenMap) {
            var inShard = indObj && indObj.stateIds && indObj.stateIds.indexOf(sid) >= 0;
            if (inShard) {
                var statePath = stateJsonPathForId(sid);
                deleteFileAtCloudPath(statePath, function (okDel) {
                if (!okDel) {
                    toast('Could not remove state file from cloud.', true);
                    return;
                }
                var nextIds = (indObj.stateIds || []).filter(function (x) {
                    return trimText(String(x)) !== sid;
                });
                var newIndex = {
                    version: 1,
                    format: 'worksheet-states-shard',
                    stateIds: nextIds,
                    updatedAt: Date.now()
                };
                putJsonAtCloudPath(
                    indexJsonPath(),
                    newIndex,
                    'Worksheet state index: remove ' + sid,
                    function (ok2, err2) {
                    if (!ok2) {
                        toast(err2 || 'Removed file but index update failed — refresh or retry.', true);
                        refreshCloudRows();
                        return;
                    }
                    toast('Removed from cloud: "' + label + '"', false);
                    refreshCloudRows();
                }
                );
            });
                return;
            }
            fetchCloudStates(function (doc, loadErr) {
                if (!doc) {
                    toast('Could not load cloud: ' + (loadErr || 'unknown error'), true);
                    return;
                }
                var arr = (doc.states || []).filter(function (st) {
                    return st && !isExpiredState(st);
                });
                var before = arr.length;
                var next = arr.filter(function (st) {
                    return trimText(String(st && st.id != null ? st.id : '')) !== sid;
                });
                if (next.length === before) {
                    toast('That cloud state was not found (expired, wrong id, or already removed).', true);
                    refreshCloudRows();
                    return;
                }
                appendCloudSyncLog('delete (legacy file): remaining states=' + next.length);
                postCloudAfterMerge(cloudDocFor(next), null, function (ok, err) {
                    if (!ok) {
                        toast(err || 'Cloud delete failed.', true);
                        return;
                    }
                    toast('Removed from cloud: "' + label + '"', false);
                    refreshCloudRows();
                });
            });
        });
    }

    function saveCurrentStateToCloud() {
        var state = collectWorksheetState();
        if (!state.items.length) {
            toast('No visible tails or N/A line numbers found to save to cloud.', true);
            return;
        }
        saveStateToCloud(state, defaultSaveLabelFromState(state));
    }

    function refreshCloudRows() {
        if (!cloudRowsHost) {
            return;
        }
        cloudRowsHost.textContent = 'Loading cloud states...';
        updateLoadFolderBanner();
        fetchCloudStates(function (doc, loadErr) {
            if (!cloudRowsHost) {
                return;
            }
            cloudRowsHost.textContent = '';
            updateLoadFolderBanner();
            if (!doc) {
                cloudRowsHost.textContent =
                    'Could not load cloud: ' + (loadErr || 'Check donkeycode_github_pat and repo/branch/path in DonkeyCODE preferences.');
                return;
            }
            var folderKey = sessionFolderKeyCanonical();
            var states = (doc.states || []).filter(function (st) {
                return st && !isExpiredState(st);
            });
            states.sort(function (a, b) {
                return String(b.savedAt || b.updatedAt || '').localeCompare(String(a.savedAt || a.updatedAt || ''));
            });
            if (!states.length) {
                cloudRowsHost.textContent =
                    'No unexpired cloud states found. If the JSON lives in a private repo, set donkeycode_github_pat and open the cloud log below. States older than 4 hours are dropped.';
                return;
            }
            var sameFolder = states.filter(function (st) {
                return normalizeFolderForCompare(st.folder) === normalizeFolderForCompare(folderKey);
            });
            var list = sameFolder.concat(
                states.filter(function (st) {
                    return normalizeFolderForCompare(st.folder) !== normalizeFolderForCompare(folderKey);
                })
            );
            for (var i = 0; i < list.length; i++) {
                cloudRowsHost.appendChild(buildCloudStateRow(list[i]));
            }
        });
    }

    function buildCloudStateRow(state) {
        var row = document.createElement('div');
        row.className = 'dc-wss-row';
        var info = document.createElement('div');
        var name = document.createElement('div');
        name.className = 'dc-wss-name';
        name.textContent = state.name || '(unnamed)';
        var meta = document.createElement('div');
        meta.className = 'dc-wss-meta';
        var cloudFolderKey = normalizeSessionFolderKey(state.folder);
        meta.textContent =
            'Session: ' +
            sessionFolderDisplayLabel(cloudFolderKey) +
            ' — ' +
            itemSummary(state.items) +
            ' — saved ' +
            formatDate(state.savedAt || state.updatedAt || state.capturedAt) +
            ' — ' +
            formatExpiresLabel(state.expiresAt);
        info.appendChild(name);
        info.appendChild(meta);

        var actions = document.createElement('div');
        actions.className = 'dc-wss-row-actions';
        var recall = document.createElement('button');
        recall.type = 'button';
        recall.textContent = 'Recall';
        recall.addEventListener('click', function () {
            closeModal();
            applyStateToWorksheet(state, 'cloud state "' + (state.name || '(unnamed)') + '"');
        });
        var delCloud = document.createElement('button');
        delCloud.type = 'button';
        delCloud.textContent = 'Delete';
        delCloud.className = 'dc-wss-danger';
        delCloud.title = 'Remove this save from the shared cloud JSON file';
        if (state.id) {
            delCloud.addEventListener('click', function (e) {
                e.stopPropagation();
                deleteCloudStateById(state.id, state.name);
            });
        } else {
            delCloud.disabled = true;
            delCloud.title = 'This entry has no id — cannot delete.';
        }
        actions.appendChild(recall);
        actions.appendChild(delCloud);
        row.appendChild(info);
        row.appendChild(actions);
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
        var actions = document.createElement('div');
        actions.className = 'dc-wss-actions';
        var save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Save current to cloud';
        save.addEventListener('click', function () {
            var st = collectWorksheetState();
            if (!st.items.length) {
                toast('No visible tails or N/A line numbers found to save to cloud.', true);
                return;
            }
            saveStateToCloud(st, defaultSaveLabelFromState(st));
        });
        var refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.textContent = 'Refresh cloud list';
        refresh.addEventListener('click', refreshCloudRows);
        actions.appendChild(save);
        actions.appendChild(refresh);
        cloudRowsHost = document.createElement('div');
        cloudRowsHost.className = 'dc-wss-cloud-rows';
        body.appendChild(actions);
        body.appendChild(cloudRowsHost);
        body.appendChild(createCloudSyncLogSection('Cloud sync debug log (Wall of Fame style)'));
        panel.appendChild(head);
        panel.appendChild(body);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        appendCloudSyncLog('Open: Cloud-only dialog — use Refresh to trace GET, Save current to cloud for full save trace.');
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

    function defaultSaveLabelFromState(state) {
        var base = 'Worksheet';
        if (state && state.title) {
            base = trimText(state.title) || base;
        } else {
            try {
                base = trimText(document.title || '') || base;
            } catch (e) {
                base = 'Worksheet';
            }
        }
        var d = new Date();
        var pad = function (n) {
            return n < 10 ? '0' + n : String(n);
        };
        return (
            base +
            ' · ' +
            d.getFullYear() +
            '-' +
            pad(d.getMonth() + 1) +
            '-' +
            pad(d.getDate()) +
            ' ' +
            pad(d.getHours()) +
            pad(d.getMinutes()) +
            pad(d.getSeconds())
        );
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

    /**
     * Every real tail token in a string (not just the first) — avoids losing N456 when N123 is first
     * in the same cell.
     */
    function allRealTailsFromText(text) {
        var matches = trimText(text).toUpperCase().match(/\bN[0-9A-Z]{2,6}\b/g);
        if (!matches || !matches.length) {
            return [];
        }
        var out = [];
        var i;
        for (i = 0; i < matches.length; i++) {
            var m = matches[i];
            if (m === 'NXXXXX' || m === 'NXXXX') {
                continue;
            }
            if (out.indexOf(m) < 0) {
                out.push(m);
            }
        }
        return out;
    }

    /** For line capture: "no real tail" (only N/AXXXX placeholders or no N-tail) so we may use N/A line #. */
    function isTailPlaceholderOrAbsent(text) {
        return allRealTailsFromText(text).length === 0;
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

            var tails = allRealTailsFromText(text);
            var tj;
            for (tj = 0; tj < tails.length; tj++) {
                var tail = tails[tj];
                var kt = 'tail:' + tail;
                if (!seen[kt]) {
                    seen[kt] = true;
                    items.push({ type: 'tail', value: tail });
                }
            }
        }
        for (i = 0; i < nodes.length; i++) {
            var el2 = nodes[i];
            if (isIgnoredNode(el2) || !isVisible(el2)) {
                continue;
            }
            var text2 = trimText(el2.textContent || '');
            if (!text2 || text2.length > 180) {
                continue;
            }
            if (!isTailPlaceholderOrAbsent(text2)) {
                continue;
            }
            if (hasMatchingDescendant(el2)) {
                continue;
            }
            var line = lineFromText(text2);
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
            items: items,
            sessionFolder: sessionFolderKeyCanonical()
        };
    }

    function findWorksheetInput(name) {
        var host = document.querySelector('div[name="' + name + '"]');
        if (!host) {
            return null;
        }
        return host.querySelector('input.search, input[aria-autocomplete="list"], input[type="text"]');
    }


    function textLabel(el) {
        return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    }

    function findWorksheetFieldsRow() {
        var buttons = document.querySelectorAll('button');
        var i;
        for (i = 0; i < buttons.length; i++) {
            if (/^Clear WS$/i.test(textLabel(buttons[i]))) {
                var fields = buttons[i].closest && buttons[i].closest('.fields');
                if (fields) {
                    return fields;
                }
            }
        }
        var sorted = document.querySelector('div[name="sortedBy"]');
        return sorted && sorted.closest ? sorted.closest('.fields') : null;
    }

    function orderWsbInHelper(helper) {
        if (!helper) {
            return;
        }
        var wxn = helper.querySelector('[data-dc-metar-watch-btn="1"]');
        var br = document.getElementById(BRIEF_HOST_ID);
        var st = document.getElementById(HOST_ID);
        var i;
        var list = [wxn, br, st];
        for (i = 0; i < list.length; i++) {
            var n = list[i];
            if (n && n.parentNode === helper) {
                try {
                    helper.appendChild(n);
                } catch (e) {}
            }
        }
    }

    function positionWorksheetHelperToRowEnd(fields, helper) {
        if (!fields || !helper) {
            return;
        }
        try {
            fields.appendChild(helper);
        } catch (e) {}
        try {
            helper.style.display = 'inline-flex';
            helper.style.alignItems = 'stretch';
            helper.style.gap = '4px';
            helper.style.marginLeft = '';
        } catch (e2) {}
    }

    function getOrCreateWorksheetHelperField() {
        var fields = findWorksheetFieldsRow();
        if (!fields) {
            return null;
        }
        var helper = fields.querySelector('[data-dc-worksheet-helper-buttons="1"]');
        if (helper) {
            positionWorksheetHelperToRowEnd(fields, helper);
            return helper;
        }
        helper = document.createElement('div');
        helper.className = 'field';
        helper.setAttribute('data-dc-worksheet-helper-buttons', '1');
        helper.style.display = 'inline-flex';
        helper.style.alignItems = 'stretch';
        helper.style.gap = '4px';
        fields.appendChild(helper);
        positionWorksheetHelperToRowEnd(fields, helper);
        return helper;
    }

    function removeEmptyWorksheetHelperField() {
        var helper = document.querySelector(
            '[data-dc-worksheet-helper-buttons="1"]'
        );
        if (
            helper &&
            !helper.querySelector(
                'button, #' + HOST_ID + ', #dc-brief-ai-ws-host, [data-dc-metar-watch-btn="1"]'
            )
        ) {
            try {
                helper.remove();
            } catch (e) {}
        }
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
        var brief = document.getElementById(BRIEF_HOST_ID);
        if (brief) {
            return brief;
        }
        var wx = document.querySelector(WX_BTN_SELECTOR);
        if (wx) {
            return wx;
        }
        return findGmtClockElement();
    }

    function elDesc(el) {
        if (!el) {
            return 'null';
        }
        var tag = (el.tagName || '?').toLowerCase();
        var id = (el.getAttribute('id') || el.id) ? ' id="' + (el.getAttribute('id') || el.id) + '"' : '';
        var cls = el.className && String(el.className) ? ' class="' + String(el.className).slice(0, 100) + '"' : '';
        var t = (el.getAttribute('data-dc-ws-action') && ' [data-dc-ws-action=' + el.getAttribute('data-dc-ws-action') + ']') || '';
        if (el.getAttribute && el.getAttribute('data-dc-metar-watch-btn')) {
            t += ' [data-dc-metar-watch-btn]';
        }
        if (el.getAttribute && el.getAttribute('data-dc-brief-ai-btn')) {
            t += ' [data-dc-brief-ai-btn]';
        }
        return '<' + tag + id + cls + '>' + t;
    }

    function ensureWorksheetToolbarClickDebug() {
        if (!isWorksheetPage() || onToolbarClickDebug) {
            return;
        }
        if (getPref('worksheetToolbarClickDebug', false) !== true) {
            return;
        }
        onToolbarClickDebug = function (ev) {
            if (!ev) {
                return;
            }
            if (ev.type !== 'pointerdown' && ev.type !== 'click') {
                return;
            }
            if (ev.button != null && ev.button !== 0) {
                return;
            }
            if (!ev.isTrusted) {
                return;
            }
            var t = ev.target;
            if (t && t.nodeType !== 1) {
                t = t.parentElement;
            }
            var hlp = t && t.closest
                ? t.closest('[data-dc-worksheet-helper-buttons="1"]')
                : null;
            if (!hlp) {
                return;
            }
            var pick = t;
            try {
                if (ev.clientX != null && ev.clientY != null) {
                    pick = document.elementFromPoint(ev.clientX, ev.clientY) || t;
                }
            } catch (e) {}
            var pickPath = [pick, t];
            if (hlp) {
                pickPath.push(hlp);
            }
            if (hlp) {
                pickPath.push(
                    hlp.querySelector('[data-dc-metar-watch-btn="1"]') || null
                );
                pickPath.push(document.getElementById(BRIEF_HOST_ID) || null);
                pickPath.push(document.getElementById(HOST_ID) || null);
            }
            var lines = ['[Wolf2.0][WS] toolbar ' + ev.type, '  target: ' + elDesc(t), '  elementFromPoint: ' + elDesc(pick)];
            var p;
            for (p = 0; p < pickPath.length; p++) {
                if (pickPath[p]) {
                    var x = pickPath[p];
                    try {
                        lines.push(
                            '  layer ' +
                            p +
                            ' z=' +
                            (x.style && x.style.zIndex) +
                            ' pe=' +
                            (x.style && x.style.pointerEvents) +
                            ' ' +
                            elDesc(x)
                        );
                    } catch (e) {}
                }
            }
            donkeycodePageLog(lines.join('\n'));
        };
        document.addEventListener('click', onToolbarClickDebug, true);
        try {
            document.addEventListener('pointerdown', onToolbarClickDebug, true);
        } catch (e) {
            document.addEventListener('mousedown', onToolbarClickDebug, true);
        }
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent =
            '[data-dc-worksheet-helper-buttons="1"],#' +
            HOST_ID +
            ',#dc-brief-ai-ws-host,button[data-dc-metar-watch-btn="1"]{' +
            'position:relative!important;z-index:2147483000!important;pointer-events:auto!important;}' +
            '#' +
            HOST_ID +
            '{display:inline-flex;align-items:stretch;gap:4px;margin-left:0;vertical-align:middle;}' +
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
            ' button[data-dc-ws-load]{background:#244b63;}' +
            '[' +
            MODAL_ATTR +
            ']{position:fixed;inset:0;z-index:10000040;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-panel{width:min(620px,calc(100vw - 24px));max-height:min(82vh,760px);overflow:hidden;display:flex;flex-direction:column;' +
            'background:#20242b;color:#ecf0f1;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.55);font:13px/1.35 system-ui,Segoe UI,sans-serif;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #374250;font-weight:700;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-head-main{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 14px;min-width:0;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-title-main{flex:0 0 auto;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-folder-inline{font-size:12px;font-weight:600;color:#5dade2;white-space:normal;word-break:break-word;max-width:100%;}' +
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
            '] .dc-wss-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:8px;border:1px solid #3f4a56;border-radius:7px;background:#262c34;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-wss-row-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end;max-width:min(360px,100%);}' +
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
            '] button.dc-wss-danger{border-color:#7e3c3c;background:#4c2424;}' +
            '#dc-ws-cloud-sync-log{flex-shrink:0;}';
        document.head.appendChild(st);
    }

    /**
     * DonkeyCODE/React may cancel default on pointerdown so a plain click handler never runs.
     * Use capture-phase pointerup (same idea as METAR watch toolbar) plus click with suppression.
     */
    function bindWorksheetToolbarButtonActivate(el, run) {
        if (!el || el.getAttribute('data-dc-ws-btn-activate') === '1') {
            return;
        }
        el.setAttribute('data-dc-ws-btn-activate', '1');
        var suppressClick = false;
        var tClear = 0;
        el.addEventListener(
            'pointerup',
            function (ev) {
                if (!ev || ev.isTrusted === false) {
                    return;
                }
                if (ev.button != null && ev.button !== 0) {
                    return;
                }
                suppressClick = true;
                if (tClear) {
                    try {
                        clearTimeout(tClear);
                    } catch (e) {}
                }
                tClear = setTimeout(function () {
                    suppressClick = false;
                }, 800);
                try {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (ev.stopImmediatePropagation) {
                        ev.stopImmediatePropagation();
                    }
                } catch (e2) {}
                try {
                    run(ev);
                } catch (e3) {}
            },
            true
        );
        el.addEventListener(
            'click',
            function (ev) {
                if (!ev || ev.isTrusted === false) {
                    return;
                }
                if (ev.button != null && ev.button !== 0) {
                    return;
                }
                if (suppressClick) {
                    suppressClick = false;
                    try {
                        ev.preventDefault();
                        ev.stopPropagation();
                    } catch (e) {}
                    return;
                }
                try {
                    ev.preventDefault();
                    ev.stopPropagation();
                } catch (e2) {}
                try {
                    run(ev);
                } catch (e3) {}
            },
            true
        );
    }

    function makeButton(label, title, action) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.setAttribute('data-dc-ws-action', String(action));
        if (action === 'load') {
            b.setAttribute('data-dc-ws-load', '1');
        } else if (action === 'quick') {
            b.setAttribute('data-dc-ws-quick', '1');
        } else {
            b.setAttribute('data-dc-ws-save', '1');
        }
        bindWorksheetToolbarButtonActivate(b, function () {
            if (action === 'load') {
                openLoadDialog();
            } else if (action === 'quick') {
                quickReload();
            } else {
                saveCurrentState();
            }
        });
        return b;
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
            host.appendChild(
                makeButton('SAVE WS', 'Save visible AC tails and N/A line fallbacks', 'save')
            );
            host.appendChild(
                makeButton(
                    'Load WS',
                    'Recall a local or cloud worksheet state',
                    'load'
                )
            );
            host.appendChild(
                makeButton(
                    'Quick reload',
                    'Temporarily save current state, hard reload this page, then restore it',
                    'quick'
                )
            );
        }
        var helper = getOrCreateWorksheetHelperField();
        var anchor = helper ? null : findMountAnchor();
        if (helper) {
            host.style.position = '';
            host.style.right = '';
            host.style.top = '';
            host.style.zIndex = '';
            if (host.parentNode !== helper) {
                try {
                    helper.appendChild(host);
                } catch (e) {}
            }
            orderWsbInHelper(helper);
            host.querySelectorAll('button').forEach(function (b) {
                b.style.minHeight = '36px';
                b.style.height = 'auto';
                b.style.alignSelf = 'stretch';
            });
        } else if (anchor && anchor.parentNode) {
            var parent = anchor.parentNode;
            host.style.position = '';
            host.style.right = '';
            host.style.top = '';
            host.style.zIndex = '';
            host.style.marginLeft = '';
            if (host.parentNode !== parent) {
                try {
                    parent.appendChild(host);
                } catch (e0) {
                    try {
                        parent.insertBefore(host, anchor.nextSibling);
                    } catch (e1) {}
                }
            } else {
                try {
                    parent.appendChild(host);
                } catch (e2) {}
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
            } catch (e3) {}
        } else if (host.parentNode !== document.body) {
            host.style.position = 'fixed';
            host.style.right = '12px';
            host.style.top = '12px';
            host.style.zIndex = '99999';
            try {
                document.body.appendChild(host);
            } catch (e4) {}
        }
        var flo = document.getElementById('dc-worksheet-scripts-float-host');
        if (flo) {
            try {
                flo.remove();
            } catch (e) {}
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

    function uniqueStateNameInStore(baseName, excludeId) {
        var b = trimText(baseName) || 'Worksheet';
        var store = readStateStore();
        var taken = function (cand) {
            var c = String(cand || '').toLowerCase();
            var j;
            for (j = 0; j < store.states.length; j++) {
                if (store.states[j].id === excludeId) {
                    continue;
                }
                if (String(store.states[j].name || '').toLowerCase() === c) {
                    return true;
                }
            }
            return false;
        };
        if (!taken(b)) {
            return b;
        }
        var n = 2;
        var cand2;
        while (n < 200) {
            cand2 = b + ' (' + n + ')';
            if (!taken(cand2)) {
                return cand2;
            }
            n++;
        }
        return b + ' ' + String(Date.now());
    }

    function saveCurrentState() {
        var state = collectWorksheetState();
        if (!state.items.length) {
            toast('No visible tails or N/A line numbers found to save.', true);
            return;
        }
        var name = uniqueStateNameInStore(defaultSaveLabelFromState(state), null);
        state.id = stateId();
        state.name = name;
        state.sessionFolder = sessionFolderKeyCanonical();
        state.updatedAt = nowIso();
        state.expiresAt = expiresAtFor(state.updatedAt);
        var store = readStateStore();
        store.states.unshift(state);
        if (writeStateStore(store)) {
            toast('Saved "' + name + '" locally (' + itemSummary(state.items) + '), expires in 4 hours. Rename or cloud in Load WS if needed.', false);
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
        wsCloudLogPre = null;
        loadFolderBannerLine = null;
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
        var localFolderLine = 'Session: not recorded';
        if (Object.prototype.hasOwnProperty.call(state, 'sessionFolder') && state.sessionFolder != null) {
            localFolderLine = 'Session: ' + sessionFolderDisplayLabel(normalizeSessionFolderKey(state.sessionFolder));
        }
        meta.textContent =
            localFolderLine +
            ' — ' +
            itemSummary(state.items) +
            ' — saved ' +
            formatDate(state.updatedAt || state.capturedAt) +
            ' — ' +
            formatExpiresLabel(state.expiresAt);
        info.appendChild(name);
        info.appendChild(meta);

        var actions = document.createElement('div');
        actions.className = 'dc-wss-row-actions';
        var recall = document.createElement('button');
        recall.type = 'button';
        recall.textContent = 'Recall';
        recall.addEventListener('click', function () {
            closeModal();
            applyStateToWorksheet(state, 'state "' + (state.name || '(unnamed)') + '"');
        });
        var rename = document.createElement('button');
        rename.type = 'button';
        rename.textContent = 'Rename';
        rename.addEventListener('click', function () {
            var start = String(state.name || state.id || '');
            var next = window.prompt('New name for this saved state:', start);
            if (next == null) {
                return;
            }
            if (renameLocalState(state.id, next)) {
                state.name = trimText(next);
                name.textContent = state.name || '(unnamed)';
                toast('Renamed to "' + state.name + '".', false);
            }
        });
        var del = document.createElement('button');
        del.type = 'button';
        del.textContent = 'Delete';
        del.className = 'dc-wss-danger';
        del.addEventListener('click', function () {
            deleteState(state.id);
            refreshLocalRows();
        });
        var toCloud = document.createElement('button');
        toCloud.type = 'button';
        toCloud.textContent = 'To cloud';
        toCloud.title = 'Upload to shared cloud; tagged for session folder ' + sessionFolderDisplayLabel(sessionFolderKeyCanonical());
        toCloud.addEventListener('click', function () {
            if (!state || !Array.isArray(state.items) || !state.items.length) {
                toast('This state is empty.', true);
                return;
            }
            saveStateToCloud({ items: state.items.slice() }, state.name);
        });
        actions.appendChild(recall);
        actions.appendChild(rename);
        actions.appendChild(toCloud);
        actions.appendChild(del);
        row.appendChild(info);
        row.appendChild(actions);
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

    function renameLocalState(id, newName) {
        newName = trimText(newName);
        if (!newName) {
            toast('State name is required.', true);
            return false;
        }
        var store = readStateStore();
        var j;
        for (j = 0; j < store.states.length; j++) {
            if (
                store.states[j].id !== id &&
                String(store.states[j].name || '').toLowerCase() === newName.toLowerCase()
            ) {
                toast('Another local save already uses that name.', true);
                return false;
            }
        }
        var k;
        for (k = 0; k < store.states.length; k++) {
            if (store.states[k].id === id) {
                store.states[k].name = newName;
                if (writeStateStore(store)) {
                    return true;
                }
                toast('Could not rename. Browser storage may be full or blocked.', true);
                return false;
            }
        }
        toast('Could not find that state to rename.', true);
        return false;
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

    function openLoadDialog() {
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
        var main = document.createElement('div');
        main.className = 'dc-wss-head-main';
        var title = document.createElement('div');
        title.className = 'dc-wss-title-main';
        title.textContent = 'Load WS';
        var loadFolderLine = document.createElement('div');
        loadFolderLine.className = 'dc-wss-folder-inline';
        donkeycodeCurrentSessionFolderRaw();
        var fkNow = sessionFolderKeyCanonical();
        var label0 = sessionFolderDisplayLabel(fkNow);
        loadFolderLine.textContent = 'Folder: ' + label0 + (fkNow !== '__default__' ? ' (' + fkNow + ')' : '');
        loadFolderBannerLine = loadFolderLine;
        main.appendChild(title);
        main.appendChild(loadFolderLine);
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', closeModal);
        head.appendChild(main);
        head.appendChild(close);

        var body = document.createElement('div');
        body.className = 'dc-wss-body';

        addSectionTitle(body, 'Local saves');
        localRowsHost = document.createElement('div');
        localRowsHost.className = 'dc-wss-local-rows';
        body.appendChild(localRowsHost);

        addSectionTitle(body, 'Cloud saves');
        var cloudActions = document.createElement('div');
        cloudActions.className = 'dc-wss-actions';
        var refreshCloud = document.createElement('button');
        refreshCloud.type = 'button';
        refreshCloud.textContent = 'Refresh cloud list';
        refreshCloud.addEventListener('click', refreshCloudRows);
        cloudActions.appendChild(refreshCloud);
        cloudRowsHost = document.createElement('div');
        cloudRowsHost.className = 'dc-wss-cloud-rows';
        body.appendChild(cloudActions);
        body.appendChild(cloudRowsHost);
        body.appendChild(createCloudSyncLogSection('Cloud sync debug log (Wall of Fame style)'));
        panel.appendChild(head);
        panel.appendChild(body);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        appendCloudSyncLog('Open: Load WS — Refresh cloud list traces GET; save uses PUT Contents API only.');
        refreshLocalRows();
        refreshCloudRows();
    }

    function getQuickReloadSettleMaxMs() {
        var n = getPref('worksheetQuickReloadSettleMs', 3200);
        if (typeof n === 'string') {
            n = parseInt(n, 10);
        }
        if (!Number.isFinite(n) || n < 800) {
            n = 800;
        }
        if (n > 20000) {
            n = 20000;
        }
        return n;
    }

    var quickReloadSettleBusy = false;

    /**
     * Before capturing state for quick reload: wait for window load, worksheet inputs, then poll until
     * visible tail/line count stops increasing (late-rendered aircraft).
     */
    function waitForWindowLoadThen(done) {
        try {
            if (document.readyState === 'complete') {
                setTimeout(done, 0);
                return;
            }
        } catch (e) {}
        window.addEventListener(
            'load',
            function () {
                done();
            },
            { once: true }
        );
    }

    function waitForTailInputReady(deadlineMs, done) {
        function tick() {
            if (findWorksheetInput('tail')) {
                done();
                return;
            }
            if (Date.now() >= deadlineMs) {
                done();
                return;
            }
            setTimeout(tick, 200);
        }
        tick();
    }

    /**
     * Poll collectWorksheetState until items.length is unchanged for 2 consecutive polls (~400ms) or deadline.
     * Keeps the snapshot with the highest item count if still growing at timeout.
     */
    function collectWorksheetStateWhenSettled(deadlineMs, done) {
        var best = null;
        var bestCount = 0;
        var lastCount = -1;
        var stablePolls = 0;
        var POLL_MS = 200;
        var STABLE_NEED = 2;
        function tick() {
            var now = Date.now();
            var state = collectWorksheetState();
            var c = state.items ? state.items.length : 0;
            if (c > bestCount) {
                bestCount = c;
                best = state;
            }
            if (c === lastCount) {
                stablePolls++;
            } else {
                lastCount = c;
                stablePolls = 0;
            }
            if (stablePolls >= STABLE_NEED && c > 0) {
                done(state);
                return;
            }
            if (now >= deadlineMs) {
                done(best || state);
                return;
            }
            setTimeout(tick, Math.min(POLL_MS, Math.max(0, deadlineMs - Date.now())));
        }
        tick();
    }

    function quickReload() {
        if (quickReloadSettleBusy) {
            return;
        }
        quickReloadSettleBusy = true;
        var settleMs = getQuickReloadSettleMaxMs();
        var t0 = Date.now();
        var deadline = t0 + settleMs;
        toast('Quick reload: waiting for worksheet / flights to finish loading...', false);

        function doReload(state) {
            quickReloadSettleBusy = false;
            if (!state || !state.items || !state.items.length) {
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
            var waited = Date.now() - t0;
            var extra =
                waited > 500
                    ? ' (waited ' + (Math.round(waited / 100) / 10) + 's for load)'
                    : '';
            toast('Saved temporary state (' + itemSummary(state.items) + ')' + extra + ', reloading...', false);
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

        waitForWindowLoadThen(function () {
            deadline = Date.now() + settleMs;
            waitForTailInputReady(deadline, function () {
                collectWorksheetStateWhenSettled(deadline, function (state) {
                    doReload(state);
                });
            });
        });
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
        var maxTries = 100;
        function needsLineInput() {
            var j;
            for (j = 0; j < state.items.length; j++) {
                if (state.items[j] && state.items[j].type === 'line') {
                    return true;
                }
            }
            return false;
        }
        function inputsReady() {
            var tailOk = !!findWorksheetInput('tail');
            if (!needsLineInput()) {
                return tailOk;
            }
            return tailOk && !!findWorksheetInput('line');
        }
        function waitAndApply() {
            tries++;
            if (typeof document !== 'undefined' && document.readyState !== 'complete') {
                if (tries >= maxTries) {
                    toast('Worksheet page did not finish loading; quick restore stopped.', true);
                    restoreTimer = null;
                    return;
                }
                restoreTimer = setTimeout(waitAndApply, 250);
                return;
            }
            if (inputsReady()) {
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
        ensureWorksheetToolbarClickDebug();
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

    var dcWsStateCleanup = function () {
        if (onToolbarClickDebug) {
            try {
                document.removeEventListener('click', onToolbarClickDebug, true);
            } catch (e) {}
            try {
                document.removeEventListener('pointerdown', onToolbarClickDebug, true);
            } catch (e1) {}
            try {
                document.removeEventListener('mousedown', onToolbarClickDebug, true);
            } catch (e2) {}
            onToolbarClickDebug = null;
        }
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
            removeEmptyWorksheetHelperField();
        } catch (e) {}
        var flo2 = document.getElementById('dc-worksheet-scripts-float-host');
        if (flo2) {
            try {
                flo2.remove();
            } catch (e) {}
        }
    };
    window.__myScriptCleanup = function () {
        try {
            dcWsStateCleanup();
        } catch (e) {}
        try {
            window.__wsStateReloadCleanup = function () {};
        } catch (e2) {}
    };
    window.__wsStateReloadCleanup = window.__myScriptCleanup;
    window.dcWsStateScriptCleanup = dcWsStateCleanup;
})();
