// ==UserScript==
// @name         WS state/reload
// @namespace    Wolf 2.0
// @version      0.2.11
// @description  Cloud save requires PAT for direct PUT (raw can load without); clearer abort + logs.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        GM_xmlhttpRequest
// @connect      *
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @donkeycode-pref {"worksheetStateUseGithubActions":{"type":"boolean","group":"Worksheet state — GitHub","label":"Use GitHub Actions (repository_dispatch)","description":"Off (default): direct Contents API PUT with donkeycode_github_pat. On: POST …/dispatches (worksheet-state-put) + team key to match WOF/WORKSHEET repo secret.","default":false},"worksheetStateProxyUrl":{"type":"string","group":"Worksheet state — GitHub","label":"Team proxy base URL (optional)","description":"Reserved: Wall of Fame uses wallOfFameProxyUrl for a server-side host. Worksheet state does not call a proxy yet — use Actions or direct API.","default":"","placeholder":""},"worksheetStateTeamKey":{"type":"string","group":"Worksheet state — GitHub","label":"Team key (Actions mode)","description":"Same value as repo secret WORKSHEET_STATE_TEAM_KEY or WOF_TEAM_KEY (Actions workflow). If blank, uses wallOfFameTeamKey. Not your GitHub PAT.","default":""},"worksheetStateDataOwner":{"type":"string","group":"Worksheet state — data file","label":"JSON repo owner","description":"Repo for worksheet-states.json. If blank: wallOfFameDataOwner → donkeycode_github_owner → MikeBane57.","default":"","placeholder":"MikeBane57"},"worksheetStateDataRepo":{"type":"string","group":"Worksheet state — data file","label":"JSON repo name","description":"If blank: wallOfFameDataRepo → donkeycode_github_repo → Wolf2.0.","default":"","placeholder":"Wolf2.0"},"worksheetStateDataBranch":{"type":"string","group":"Worksheet state — data file","label":"JSON branch","description":"If blank: wallOfFameDataBranch → donkeycode_github_branch → main.","default":"","placeholder":"main"},"worksheetStateRepoPath":{"type":"string","group":"Worksheet state — data file","label":"JSON path in repo","description":"Path to worksheet-states.json — NOT the Wall of Fame file. Empty → WORKSHEET STATES/worksheet-states.json","default":"","placeholder":"WORKSHEET STATES/worksheet-states.json"},"worksheetToolbarClickDebug":{"type":"boolean","group":"Worksheet state","label":"Log click target (debug)","description":"Log pointerdown/click in capture: target + elementFromPoint.","default":false}}
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
    var GITHUB_REPO = 'Wolf2.0';
    var GITHUB_BRANCH = 'main';
    var CLOUD_FILE_PATH = 'WORKSHEET STATES/worksheet-states.json';
    var CLOUD_EVENT_TYPE = 'worksheet-state-put';

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

    function boolWorksheetActionsEnabled() {
        var v = getPref('worksheetStateUseGithubActions', false);
        if (v === true || v === 'true' || v === 1) {
            return true;
        }
        if (v === false || v === 'false' || v === 0) {
            return false;
        }
        return false;
    }

    function useWorksheetGithubActions() {
        return boolWorksheetActionsEnabled();
    }

    function worksheetActionsModeReady() {
        if (!useWorksheetGithubActions()) {
            return false;
        }
        if (!trimText(getPref('worksheetStateTeamKey', '')) && !trimText(getPref('wallOfFameTeamKey', ''))) {
            return false;
        }
        if (!trimText(getPref('donkeycode_github_pat', ''))) {
            return false;
        }
        return true;
    }

    /**
     * Repo for worksheet JSON: worksheet prefs → WoF data prefs → DonkeyCODE session sync
     * (donkeycode_github_owner/repo/branch) → MikeBane57 / Wolf2.0 / main.
     * Same idea as wallOfFameData* overriding session when sync points at another repo.
     */
    function resolvedCloudOwner() {
        return (
            trimText(getPref('worksheetStateDataOwner', '')) ||
            trimText(getPref('wallOfFameDataOwner', '')) ||
            trimText(getPref('donkeycode_github_owner', '')) ||
            GITHUB_OWNER
        );
    }

    function resolvedCloudRepo() {
        return (
            trimText(getPref('worksheetStateDataRepo', '')) ||
            trimText(getPref('wallOfFameDataRepo', '')) ||
            trimText(getPref('donkeycode_github_repo', '')) ||
            GITHUB_REPO
        );
    }

    function resolvedCloudBranch() {
        return (
            trimText(getPref('worksheetStateDataBranch', '')) ||
            trimText(getPref('wallOfFameDataBranch', '')) ||
            trimText(getPref('donkeycode_github_branch', '')) ||
            GITHUB_BRANCH
        );
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

    /** DonkeyCODE-injected: __default__ or a folder key (e.g. ops/team1). Read at runtime; do not hard-code. */
    function donkeycodeCurrentSessionFolderRaw() {
        return trimText(getPref('donkeycode_current_session_folder', ''));
    }

    function legacySessionFolderFromPrefs() {
        var keys = [
            'donkeycode_current_folder',
            'donkeycode_folder',
            'donkeycode_active_session_folder',
            'donkeycode_session_folder',
            'donkeycode_session_name',
            'donkeycode_active_session',
            'donkeycode_active_session_name',
            'donkeycode_session',
            'donkeycode_active_tab_folder'
        ];
        var i;
        for (i = 0; i < keys.length; i++) {
            var v = trimText(getPref(keys[i], ''));
            if (v) {
                var t = v.replace(/^\/+|\/+$/g, '');
                if (!t) {
                    continue;
                }
                if (/[\\/]/.test(t) && (t.indexOf('github') >= 0 || t.indexOf('.com') >= 0 || t.split('/').length > 2)) {
                    var seg = t.split(/[\\/]+/).filter(Boolean);
                    t = seg[seg.length - 1] || t;
                }
                return t || 'Default';
            }
        }
        return '';
    }

    /**
     * Canonical folder key for storage and equality (cloud/local). __default__ = built-in Default folder.
     * Legacy "Default" / "default" maps to __default__.
     */
    function sessionFolderKeyCanonical() {
        var r = donkeycodeCurrentSessionFolderRaw();
        if (r) {
            if (r === '__default__' || r.toLowerCase() === 'default') {
                return '__default__';
            }
            return r;
        }
        var leg = trimText(legacySessionFolderFromPrefs());
        if (!leg || leg === 'Default') {
            return '__default__';
        }
        return leg;
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
        try {
            console.info('[WS State][cloud]', msg);
        } catch (e) {}
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
        sum.title = 'Expand to view fetch/dispatch log (Wall of Fame style)';
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

    function rawGithubGetCloud(cb) {
        var rawUrl = rawCloudUrl();
        appendCloudSyncLog('GET (raw) ' + rawUrl);
        gmXhr('GET', rawUrl, { Accept: 'application/json' }, null, function (status, text) {
            if (status === 404) {
                if (resolvedGithubPat()) {
                    appendCloudSyncLog(
                        'raw GET: HTTP 404 — not served from raw (private repo, or file not on CDN). Trying Contents API with PAT…'
                    );
                    cb(null, null, null);
                } else {
                    appendCloudSyncLog('raw GET: HTTP 404 (no public file at this path) — using empty document.');
                    cb(cloudDocFor([]), null, null);
                }
                return;
            }
            if (status < 200 || status >= 300) {
                if (!status) {
                    var err0 =
                        'raw.githubusercontent.com: ' +
                        (githubApiErrorSummary(0, text) || 'request failed (private repo needs PAT for API fallback).');
                    appendCloudSyncLog('raw GET failed: ' + err0);
                    cb(
                        null,
                        err0,
                        null
                    );
                    return;
                }
                var err1 =
                    'raw.githubusercontent.com HTTP ' +
                    status +
                    (text ? ' — ' + githubApiErrorSummary(status, text) : ' (is the repo public, or is donkeycode_github_pat set for private read?)');
                appendCloudSyncLog('raw GET failed: ' + err1);
                cb(
                    null,
                    err1,
                    null
                );
                return;
            }
            appendCloudSyncLog('raw GET: OK, parsing JSON…');
            cb(parseCloudDocument(text || '{"states":[]}'), null, null);
        });
    }

    function githubGetCloud(cb) {
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
        var cUrl = githubContentsApiUrl() + '?ref=' + encodeURIComponent(resolvedCloudBranch());
        appendCloudSyncLog('GET (Contents API) ' + cUrl);
        gmXhr('GET', cUrl, githubApiHeaders(), null, function (status, text) {
            if (status === 404) {
                appendCloudSyncLog('GET /contents/: HTTP 404 (no file yet) — using empty document.');
                cb(cloudDocFor([]), null, null);
                return;
            }
            if (status < 200 || status >= 300) {
                var err2 =
                    'GET /contents/' + resolvedCloudPath() + ' HTTP ' + status + ' — ' + githubApiErrorSummary(status, text);
                appendCloudSyncLog('GET /contents/ failed: ' + err2);
                cb(null, err2, null);
                return;
            }
            var meta = safeJsonParse(text, null);
            if (!meta) {
                appendCloudSyncLog('GET /contents/: could not parse metadata JSON.');
                cb(null, 'Contents API: could not parse file metadata JSON.', null);
                return;
            }
            var fsha = meta && meta.sha ? String(meta.sha) : null;
            appendCloudSyncLog('GET /contents/: OK, file sha: ' + (fsha ? fsha.slice(0, 7) + '…' : '(none)'));
            appendCloudSyncLog('GET /contents/: decoded blob, parsing document…');
            cb(parseCloudDocument(decodeGithubFileContent(meta.content || '')), null, fsha);
        });
    }

    function fetchCloudStates(cb) {
        var mode = useWorksheetGithubActions() ? 'actions' : 'direct-API';
        appendCloudSyncLog(
            'Cloud mode: ' +
                mode +
                ' — repo ' +
                resolvedCloudOwner() +
                '/' +
                resolvedCloudRepo() +
                '@' +
                resolvedCloudBranch() +
                ' path ' +
                resolvedCloudPath() +
                '. (worksheet state prefs → wallOfFame data prefs → donkeycode_github_*)'
        );
        if (!useWorksheetGithubActions() && !resolvedGithubPat()) {
            appendCloudSyncLog('Direct mode requires donkeycode_github_pat for GET/PUT Contents API.');
        }
        rawGithubGetCloud(function (doc, rawErr) {
            if (doc) {
                var n0 = (doc.states && doc.states.length) || 0;
                appendCloudSyncLog('Load OK (raw): ' + n0 + ' state(s) after parse/prune. (no blob sha — direct PUT will GET if needed.)');
                cb(doc, null, null);
                return;
            }
            appendCloudSyncLog('Falling back to GitHub Contents API (private repo or raw failed)…');
            githubGetCloud(function (doc2, apiErr, sha) {
                if (doc2) {
                    var n2 = (doc2.states && doc2.states.length) || 0;
                    appendCloudSyncLog('Load OK (Contents API): ' + n2 + ' state(s) after parse/prune.');
                    cb(doc2, null, sha);
                    return;
                }
                var err =
                    apiErr ||
                    rawErr ||
                    'Could not load cloud JSON (check prefs, donkeycode_github_*, and worksheetStateRepoPath).';
                appendCloudSyncLog('Load failed: ' + err);
                cb(null, err, null);
            });
        });
    }

    function getContentsMetadataForPut(cb) {
        if (!resolvedGithubPat()) {
            cb(null, 'No PAT for GET /contents/');
            return;
        }
        var cUrl = githubContentsApiUrl() + '?ref=' + encodeURIComponent(resolvedCloudBranch());
        appendCloudSyncLog('PUT prep: GET metadata + SHA ' + cUrl);
        gmXhr('GET', cUrl, githubApiHeaders(), null, function (status, text) {
            if (status === 404) {
                appendCloudSyncLog('PUT prep: file absent (HTTP 404) — will create on PUT without sha.');
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

    function putCloudDocumentDirect(finalDoc, knownSha, cb) {
        if (!resolvedGithubPat()) {
            var perr =
                'Direct mode: set donkeycode_github_pat with Contents read/write for repo ' +
                resolvedCloudOwner() +
                '/' +
                resolvedCloudRepo() +
                '. (Reading the file from raw.githubusercontent.com does not use your PAT; only API PUT can save.)';
            appendCloudSyncLog('PUT aborted: ' + perr);
            cb(false, perr);
            return;
        }
        var branch = resolvedCloudBranch();
        var path = resolvedCloudPath();
        var jsonStr = JSON.stringify(finalDoc, null, 2) + '\n';
        function doPut(sha, isRetry) {
            var body = {
                message: isRetry ? 'Worksheet states: sync (retry after conflict)' : 'Worksheet states: sync (DonkeyCODE direct API)',
                content: utf8ToBase64(jsonStr),
                branch: branch
            };
            if (sha) {
                body.sha = sha;
            }
            var url = githubContentsApiUrl();
            appendCloudSyncLog(
                'PUT Contents ' + path + (sha ? ' (sha ' + String(sha).slice(0, 7) + '…)' : ' (new file)') + ' on ' + branch
            );
            var headers = githubApiHeaders();
            headers['Content-Type'] = 'application/json';
            gmXhr('PUT', url, headers, body, function (status, text) {
                if (status === 200 || status === 201) {
                    appendCloudSyncLog('PUT succeeded: HTTP ' + status);
                    cb(true, null);
                    return;
                }
                if (status === 409 && !isRetry) {
                    appendCloudSyncLog('PUT HTTP 409 conflict — refetching SHA, retrying once…');
                    getContentsMetadataForPut(function (m, err) {
                        if (err || !m) {
                            cb(false, err || '409 and could not refetch SHA');
                            return;
                        }
                        doPut(m.sha, true);
                    });
                    return;
                }
                var detail = githubApiErrorSummary(status, text);
                var msg = 'PUT failed: HTTP ' + status + (detail ? ' — ' + detail : '');
                appendCloudSyncLog(msg);
                cb(false, msg);
            });
        }
        if (knownSha) {
            doPut(knownSha, false);
        } else {
            getContentsMetadataForPut(function (m, err) {
                if (err) {
                    cb(false, err);
                    return;
                }
                doPut(m && m.sha ? m.sha : null, false);
            });
        }
    }

    function postCloudAfterMerge(mergedDoc, fileSha, cb) {
        if (useWorksheetGithubActions()) {
            appendCloudSyncLog(
                'Publish: GitHub Actions (POST …/dispatches, event ' +
                    CLOUD_EVENT_TYPE +
                    '). Pref worksheetStateUseGithubActions is ON — not using direct Contents API PUT.'
            );
            dispatchCloudDoc(mergedDoc, cb);
            return;
        }
        appendCloudSyncLog(
            'Publish: direct GitHub Contents API PUT (default). Pref worksheetStateUseGithubActions is OFF → PUT api.github.com/repos/' +
                resolvedCloudOwner() +
                '/' +
                resolvedCloudRepo() +
                '/contents/' +
                resolvedCloudPath() +
                ' on ' +
                resolvedCloudBranch()
        );
        var finalDoc = cloudDocFor((mergedDoc && mergedDoc.states) || []);
        putCloudDocumentDirect(finalDoc, fileSha, cb);
    }

    function dispatchCloudDoc(doc, cb) {
        if (!trimText(getPref('worksheetStateTeamKey', '')) && !trimText(getPref('wallOfFameTeamKey', ''))) {
            var a = 'Set worksheetStateTeamKey or wallOfFameTeamKey in DonkeyCODE (must match WOF_TEAM_KEY or WORKSHEET_STATE_TEAM_KEY in repo).';
            appendCloudSyncLog('Save aborted: ' + a);
            cb(false, a);
            return;
        }
        if (!resolvedGithubPat()) {
            var b = 'Set donkeycode_github_pat in DonkeyCODE prefs so repository_dispatch can run.';
            appendCloudSyncLog('Save aborted: ' + b);
            cb(false, b);
            return;
        }
        var teamKey = resolvedTeamKey();
        if (!teamKey) {
            cb(false, 'Team key missing');
            return;
        }
        var headers = githubApiHeaders();
        headers['Content-Type'] = 'application/json';
        var stArr = (doc && doc.states) || [];
        var body = {
            event_type: CLOUD_EVENT_TYPE,
            client_payload: {
                team_key: teamKey,
                document: cloudDocFor(stArr),
                path: resolvedCloudPath()
            }
        };
        var url =
            'https://api.github.com/repos/' +
            encodeURIComponent(resolvedCloudOwner()) +
            '/' +
            encodeURIComponent(resolvedCloudRepo()) +
            '/dispatches';
        appendCloudSyncLog(
            'POST repository_dispatch event ' +
                CLOUD_EVENT_TYPE +
                ' to ' +
                resolvedCloudOwner() +
                '/' +
                resolvedCloudRepo() +
                ', path in payload: ' +
                resolvedCloudPath() +
                ', states in merge: ' +
                stArr.length
        );
        gmXhr('POST', url, headers, body, function (status, text) {
            if (status === 204) {
                appendCloudSyncLog('Dispatch accepted: HTTP 204. Check GitHub Actions → Worksheet state sync.');
                cb(true, null);
                return;
            }
            var detail = githubApiErrorSummary(status, text);
            var msg =
                'POST repository_dispatch failed: HTTP ' +
                status +
                (detail ? ' — ' + detail : '') +
                (status === 403 && /workflow/i.test(String(detail))
                    ? ' Regenerate donkeycode_github_pat with "workflow" scope (same as Wall of Fame).'
                    : '');
            appendCloudSyncLog('Dispatch failed: ' + msg);
            cb(false, msg);
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
        toast('Loading cloud states before save...', false);
        appendCloudSyncLog(
            'saveStateToCloud: name="' + name + '", folder=' + folderKey + ' (' + folderLabel + '), items=' + (state.items && state.items.length ? state.items.length : 0)
        );
        appendCloudSyncLog(
            'saveStateToCloud: donkeycode_github_pat ' +
                (resolvedGithubPat() ? 'is set (required for direct API save)' : 'is EMPTY') +
                ' — target ' +
                resolvedCloudOwner() +
                '/' +
                resolvedCloudRepo() +
                ' path ' +
                resolvedCloudPath()
        );
        fetchCloudStates(function (doc, loadErr, fileSha) {
            if (!doc) {
                toast('Could not load cloud: ' + (loadErr || 'unknown error'), true);
                if (cb) {
                    cb(false);
                }
                return;
            }
            if (!useWorksheetGithubActions() && !resolvedGithubPat()) {
                var needPat =
                    'To save, set donkeycode_github_pat (classic: repo scope, or fine-grained: Contents R/W) for ' +
                    resolvedCloudOwner() +
                    '/' +
                    resolvedCloudRepo() +
                    '. The list can load from raw.githubusercontent.com without a token; only the GitHub API can write the file.';
                appendCloudSyncLog('saveStateToCloud ABORT: ' + needPat);
                toast(needPat, true);
                if (cb) {
                    cb(false);
                }
                return;
            }
            var states = (doc.states || []).filter(function (st) {
                return st && st.id !== state.id && !isExpiredState(st);
            });
            states.unshift(normalizeCloudState(state));
            appendCloudSyncLog('Merged new state; publishing, total states=' + states.length + (fileSha ? ' (use GET sha: ' + String(fileSha).slice(0, 7) + '…)' : ' (raw load: refetch sha if PUT)') + '…');
            postCloudAfterMerge(cloudDocFor(states), fileSha, function (ok, err) {
                if (!ok) {
                    toast(err || 'Cloud save failed.', true);
                    if (cb) {
                        cb(false);
                    }
                    return;
                }
                if (useWorksheetGithubActions()) {
                    toast('Cloud save requested for "' + name + '". It may take a moment (Actions) to appear.', false);
                } else {
                    toast('Saved to cloud: "' + name + '" in ' + resolvedCloudOwner() + '/' + resolvedCloudBranch() + ' ' + resolvedCloudPath(), false);
                }
                refreshCloudRows();
                if (cb) {
                    cb(true);
                }
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
        fetchCloudStates(function (doc, loadErr) {
            if (!cloudRowsHost) {
                return;
            }
            cloudRowsHost.textContent = '';
            if (!doc) {
                cloudRowsHost.textContent =
                    'Could not load cloud: ' + (loadErr || 'Check PAT (repo + workflow scope), team key = WOF/WORKSHEET secret, and repo/branch/path.');
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
        var toCloud = document.createElement('button');
        toCloud.type = 'button';
        toCloud.textContent = 'Save copy to cloud';
        toCloud.title = 'Copy this snapshot to shared cloud (same as Load WS → Cloud saves)';
        toCloud.addEventListener('click', function () {
            var snap = { items: (state.items || []).slice() };
            if (state.title) {
                snap.title = state.title;
            }
            saveStateToCloud(snap, state.name);
        });
        actions.appendChild(recall);
        actions.appendChild(toCloud);
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
            items: items,
            sessionFolder: sessionFolderKeyCanonical()
        };
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
            try {
                console.log(lines.join('\n'));
            } catch (e) {}
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
            if (!window.confirm('Delete saved state "' + (state.name || '(unnamed)') + '"?')) {
                return;
            }
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
        var title = document.createElement('div');
        title.textContent = 'Load WS';
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', closeModal);
        head.appendChild(title);
        head.appendChild(close);

        var body = document.createElement('div');
        body.className = 'dc-wss-body';

        var loadFolderLine = document.createElement('div');
        loadFolderLine.className = 'dc-wss-note';
        var fkNow = sessionFolderKeyCanonical();
        loadFolderLine.textContent =
            'Active session folder: ' + sessionFolderDisplayLabel(fkNow) + (fkNow !== '__default__' ? ' (' + fkNow + ')' : '');
        body.appendChild(loadFolderLine);

        addSectionTitle(body, 'Local saves');
        var localNote = document.createElement('div');
        localNote.className = 'dc-wss-note';
        localNote.textContent = 'Local saves are listed first and stay in this browser only.';
        localRowsHost = document.createElement('div');
        localRowsHost.className = 'dc-wss-local-rows';
        body.appendChild(localNote);
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
        appendCloudSyncLog('Open: Load WS — use Refresh cloud list to trace raw/API GETs; To cloud or dispatch logs POST 204.');
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
