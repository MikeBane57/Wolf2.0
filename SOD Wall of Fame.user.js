// ==UserScript==
// @name         SOD Wall of Fame
// @namespace    Wolf 2.0
// @version      2.7.9
// @description  WoF: GM_xhr GET without data field + full request log (fixes silent fetch). Direct API default.
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      *
// @donkeycode-pref {"wallOfFameShowTab":{"type":"boolean","group":"Wall of Fame","label":"Show Wall of Fame tab","description":"Tab next to FIMS / Advisories on the FIMS widget.","default":true},"wallOfFameDataOwner":{"type":"string","group":"Wall of Fame — data file","label":"JSON repo owner","description":"GitHub user/org that owns wall-of-fame.json. Default MikeBane57. Set this if session sync points at a different repo (e.g. DonkeyCODE) — WoF file still lives in Wolf2.0 unless you override all three.","default":"","placeholder":"MikeBane57"},"wallOfFameDataRepo":{"type":"string","group":"Wall of Fame — data file","label":"JSON repo name","description":"Repo containing wall-of-fame.json. Default Wolf2.0.","default":"","placeholder":"Wolf2.0"},"wallOfFameDataBranch":{"type":"string","group":"Wall of Fame — data file","label":"JSON branch","description":"Branch for raw + Contents API. Default main.","default":"","placeholder":"main"},"wallOfFamePreferDirectContentsApi":{"type":"boolean","group":"Wall of Fame — data file","label":"Prefer direct Contents API (GET/PUT)","description":"On (default): with donkeycode_github_pat, use GitHub Contents API for all fetch and publish (not raw.githubusercontent.com or repository_dispatch). Turn off to use \u201cUse Actions + repo secret\u201d + team key (raw + dispatch) when those are on.","default":true},"wallOfFameUseGithubActions":{"type":"boolean","group":"Wall of Fame — GitHub Actions","label":"Use Actions + repo secret","description":"If on: fetch from raw.githubusercontent.com; publish via repository_dispatch. Set repo secret WOF_TEAM_KEY to match wallOfFameTeamKey. Publish still needs donkeycode_github_pat to trigger the workflow.","default":false},"wallOfFameTeamKey":{"type":"string","group":"Wall of Fame — GitHub Actions","label":"Team key (matches WOF_TEAM_KEY)","description":"Same value as repository secret WOF_TEAM_KEY (Settings → Secrets). Not the GitHub PAT.","default":"","placeholder":""},"wallOfFameRepoPath":{"type":"string","group":"Wall of Fame — GitHub Actions","label":"JSON path in repo (optional)","description":"Path to wall-of-fame.json in Wolf2.0, e.g. WALL of FAME/wall-of-fame.json. Leave empty for default. Do not use session sync folder unless your file lives there.","default":"","placeholder":"WALL of FAME/wall-of-fame.json"},"wallOfFameProxyUrl":{"type":"url","group":"Wall of Fame — team proxy","label":"Proxy base URL (optional)","description":"HTTPS URL of wall-of-fame-proxy. If set with team key, overrides Actions mode for sync.","default":"","placeholder":"https://wof.example.com"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SOD%20Wall%20of%20Fame.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SOD%20Wall%20of%20Fame.user.js
// ==/UserScript==

(function() {
    'use strict';

    var TABLE_ID = 'fims-id';
    var TAB_ID = 'dc-wof-tab';
    var PANEL_ID = 'dc-wof-panel';
    var TCP_PANEL_ID = 'dc-fims-top-clickers-panel';
    var STYLE_ID = 'dc-wof-style';
    var HIDE_FIMS_FOR_ADVIS_ATTR = 'data-dc-fims-id-hide-for-advisories';

    /** Defaults when DonkeyCODE session-sync prefs are absent (getPref('donkeycode_github_*')). */
    var GITHUB_OWNER = 'MikeBane57';
    var GITHUB_REPO = 'Wolf2.0';
    var GITHUB_BRANCH = 'main';
    /** Repo path when sessions root is empty; else file is {sessionsRoot}/wall-of-fame.json */
    var WALL_OF_FAME_FILE_PATH = 'WALL of FAME/wall-of-fame.json';

    /**
     * PAT from DonkeyCODE session sync (extension settings). Used for GitHub API only.
     * Injected getPref must expose donkeycode_github_pat.
     */
    function resolvedGithubPat() {
        return String(getPref('donkeycode_github_pat', '') || '').trim();
    }

    /**
     * Repo that holds wall-of-fame.json (raw + Contents API + repository_dispatch).
     * Defaults to Wolf2.0 — NOT session-sync owner/repo, so sync can target DonkeyCODE
     * while accolades stay in Wolf2.0. Override via wallOfFameDataOwner/Repo/Branch.
     */
    function resolvedWallOfFameDataOwner() {
        var o = String(getPref('wallOfFameDataOwner', '') || '').trim();
        return o || GITHUB_OWNER;
    }

    function resolvedWallOfFameDataRepo() {
        var r = String(getPref('wallOfFameDataRepo', '') || '').trim();
        return r || GITHUB_REPO;
    }

    function resolvedWallOfFameDataBranch() {
        var b = String(getPref('wallOfFameDataBranch', '') || '').trim();
        return b || GITHUB_BRANCH;
    }

    /**
     * Path to wall-of-fame.json in the repo. Not derived from donkeycode_github_sessions_root
     * (that path is for session files and breaks WoF if set to e.g. sessions/).
     */
    function resolvedGithubFilePath() {
        var custom = String(getPref('wallOfFameRepoPath', '') || '').trim();
        if (custom) {
            return custom.replace(/^\/+/, '');
        }
        return WALL_OF_FAME_FILE_PATH;
    }

    function hideTopClickersPanel() {
        var tcp = document.getElementById(TCP_PANEL_ID);
        if (tcp) {
            tcp.style.display = 'none';
        }
        var tcTab = document.getElementById('dc-fims-top-clickers-host');
        if (tcTab) {
            tcTab.classList.remove('active');
        }
    }

    var LS_KEY = 'donkeycode.sodWallOfFame.v1';
    var SESSION_KEY = 'dc_wof_unlocked';
    var EDIT_PASSWORD = 'DonkeyWall';
    var editPanelOpen = false;
    /** When set, that card shows inline edit fields (unlock + Edit panel open). */
    var wofEditingId = null;

    var rootMo = null;
    var onPopState = null;
    var onHashChange = null;
    var navInterval = null;
    var lastNavKey = '';

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

    function wofLogSyncLine(panel, msg) {
        var p = panel || document.getElementById(PANEL_ID);
        wofAppendPublishLog(p, msg);
    }

    function wofAppendPublishLog(panel, msg) {
        var line =
            '[' +
            new Date().toISOString().replace('T', ' ').slice(0, 23) +
            '] ' +
            msg;
        try {
            console.info('[Wall of Fame]', msg);
        } catch (e) {}
        var el = panel
            ? panel.querySelector('#dc-wof-publish-log')
            : document.getElementById('dc-wof-publish-log');
        if (el) {
            el.textContent = (el.textContent ? el.textContent + '\n' : '') + line;
            el.scrollTop = el.scrollHeight;
        }
    }

    function wofClearPublishLog(panel) {
        var el = panel
            ? panel.querySelector('#dc-wof-publish-log')
            : document.getElementById('dc-wof-publish-log');
        if (el) {
            el.textContent = '';
        }
    }

    /** Log a change that is saved locally only until the user clicks Publish. */
    function wofLogLocalDraft(panel, msg) {
        wofAppendPublishLog(panel, 'Local (not repo yet): ' + msg);
    }

    function proxyBaseUrl() {
        var u = String(getPref('wallOfFameProxyUrl', '') || '').trim().replace(/\/+$/, '');
        return u;
    }

    function proxyTeamKey() {
        return String(getPref('wallOfFameTeamKey', '') || '').trim();
    }

    function useGithubActions() {
        var v = getPref('wallOfFameUseGithubActions', false);
        return v === true || v === 'true';
    }

    /**
     * When true (default) and a PAT is set, fetch/publish use GitHub Contents API (GET/PUT) only.
     * Turn off to use Actions+raw/team key flow when wallOfFameUseGithubActions + wallOfFameTeamKey.
     */
    function wallOfFamePreferDirectContentsApi() {
        var v = getPref('wallOfFamePreferDirectContentsApi', true);
        if (v === false || v === 'false' || v === 0) {
            return false;
        }
        return true;
    }

    /** Repo secret WOF_TEAM_KEY must match; workflow validates server-side. */
    function actionsModeConfigured() {
        return useGithubActions() && !!proxyTeamKey();
    }

    function proxyConfigured() {
        return !!(proxyBaseUrl() && proxyTeamKey());
    }

    function rawGithubWallOfFameUrl() {
        var owner = resolvedWallOfFameDataOwner();
        var repo = resolvedWallOfFameDataRepo();
        var branch = resolvedWallOfFameDataBranch();
        var rel = resolvedGithubFilePath().replace(/^\/+/, '');
        var encodedPath = rel.split('/').map(encodeURIComponent).join('/');
        return (
            'https://raw.githubusercontent.com/' +
            encodeURIComponent(owner) +
            '/' +
            encodeURIComponent(repo) +
            '/' +
            encodeURIComponent(branch) +
            '/' +
            encodedPath
        );
    }

    /**
     * Public raw file GET. Returns null entries → caller may fall back to Contents API (private repo).
     */
    function rawGithubGet(cb, logDebug) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            if (typeof logDebug === 'function') {
                logDebug('raw GET skipped: GM_xmlhttpRequest unavailable (DonkeyCODE / @grant).');
            }
            cb(null);
            return;
        }
        var u = rawGithubWallOfFameUrl();
        GM_xmlhttpRequest({
            method: 'GET',
            url: u,
            onload: function(res) {
                var st = res.status || 0;
                if (typeof logDebug === 'function') {
                    logDebug('raw GET HTTP ' + st + ' — ' + u);
                }
                if (st === 404) {
                    cb([]);
                    return;
                }
                if (st < 200 || st >= 300) {
                    cb(null);
                    return;
                }
                var text = res.responseText || '';
                var entries = parseEntriesFromJsonText(text);
                if (entries === null) {
                    if (typeof logDebug === 'function') {
                        logDebug('raw: JSON parse failed (invalid wall-of-fame.json).');
                    }
                    cb(null);
                    return;
                }
                cb(entries);
            },
            onerror: function() {
                if (typeof logDebug === 'function') {
                    logDebug('raw GET network error — ' + u);
                }
                cb(null);
            }
        });
    }

    function githubRepositoryDispatch(doc, cb) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            cb(false, 'GM_xmlhttpRequest unavailable');
            return;
        }
        var owner = resolvedWallOfFameDataOwner();
        var repo = resolvedWallOfFameDataRepo();
        var url =
            'https://api.github.com/repos/' +
            encodeURIComponent(owner) +
            '/' +
            encodeURIComponent(repo) +
            '/dispatches';
        var headers = githubApiHeaders();
        headers['Content-Type'] = 'application/json';
        var payload = {
            team_key: proxyTeamKey(),
            document: doc,
            path: resolvedGithubFilePath()
        };
        var body = {
            event_type: 'wall-of-fame-put',
            client_payload: payload
        };
        GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: headers,
            data: JSON.stringify(body),
            onload: function(res) {
                var st = res.status || 0;
                if (st === 204) {
                    cb(true, null);
                    return;
                }
                cb(
                    false,
                    'Dispatch HTTP ' + st + ' ' + (res.responseText || '').slice(0, 400)
                );
            },
            onerror: function() {
                cb(false, 'Network error');
            }
        });
    }

    /** Last blob SHA for GitHub Contents API (updates require SHA). */
    var githubFileSha = null;

    function githubConfigured() {
        return !!resolvedGithubPat();
    }

    function syncConfigured() {
        return proxyConfigured() || githubConfigured() || actionsModeConfigured();
    }

    /** repository_dispatch needs a PAT with repo scope (same as session sync). */
    function actionsPublishConfigured() {
        return actionsModeConfigured() && githubConfigured();
    }

    function proxyRequest(method, bodyObj, cb) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            cb(0, '');
            return;
        }
        var base = proxyBaseUrl();
        var key = proxyTeamKey();
        var url = base + '/wall-of-fame';
        var headers = {
            Accept: 'application/json',
            'X-Wall-Of-Fame-Key': key
        };
        var hasBody = bodyObj !== undefined && bodyObj !== null;
        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        }
        var pdata = undefined;
        if (hasBody) {
            pdata = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
        }
        GM_xmlhttpRequest({
            method: method,
            url: url,
            headers: headers,
            data: pdata,
            onload: function(res) {
                cb(res.status || 0, res.responseText || '');
            },
            onerror: function() {
                cb(0, '');
            }
        });
    }

    function proxyGetFile(cb) {
        proxyRequest('GET', null, function(status, text) {
            if (status < 200 || status >= 300) {
                cb(null);
                return;
            }
            try {
                var entries = parseEntriesFromJsonText(text);
                cb(entries);
            } catch (e) {
                cb(null);
            }
        });
    }

    function proxyPutDocument(doc, cb) {
        proxyRequest('PUT', doc, function(status, text) {
            if (status >= 200 && status < 300) {
                cb(true, null);
                return;
            }
            if (status === 401) {
                cb(false, 'Proxy rejected team key (check wallOfFameTeamKey).');
                return;
            }
            if (status === 409) {
                cb(false, 'conflict');
                return;
            }
            var err = 'HTTP ' + status;
            try {
                var j = JSON.parse(text);
                if (j.error) {
                    err = String(j.error);
                }
            } catch (e) {
                if (text) {
                    err = text.slice(0, 300);
                }
            }
            cb(false, err);
        });
    }

    function githubContentsApiUrl() {
        var owner = encodeURIComponent(resolvedWallOfFameDataOwner());
        var repo = encodeURIComponent(resolvedWallOfFameDataRepo());
        var path = resolvedGithubFilePath()
            .replace(/^\/+/, '')
            .split('/')
            .map(encodeURIComponent)
            .join('/');
        return 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;
    }

    function githubApiHeaders() {
        return {
            Authorization: 'Bearer ' + resolvedGithubPat(),
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    }

    function utf8ToBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
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

    function parseEntriesFromJsonText(text) {
        try {
            var data = JSON.parse(text);
            var arr = Array.isArray(data) ? data : (data.entries || []);
            return arr.map(normalizeEntry).filter(Boolean);
        } catch (e) {
            try {
                console.warn(
                    '[Wall of Fame] Invalid JSON in wall-of-fame.json — fix the file in the repo (commas, trailing commas).',
                    e && e.message ? e.message : e
                );
            } catch (ignore) {}
            return null;
        }
    }

    /**
     * Explains GitHub 4xx/0 when publish fails (token, permissions, or very old DonkeyCODE
     * without request-body forwarding).
     */
    function explainGithubPublishError(status, responseText) {
        var raw = String(responseText || '');
        var msg = '';
        try {
            var j = JSON.parse(raw);
            if (j.message) {
                msg = String(j.message);
            }
        } catch (e) {
            msg = raw.slice(0, 400);
        }
        var blob = (msg + ' ' + raw).toLowerCase();
        if (status === 401) {
            return 'GitHub returned 401 — check the PAT (repo scope) and that it is not expired.';
        }
        if (status === 403) {
            return 'GitHub returned 403 — token may lack Contents write on this repo or path (fine-grained rules).';
        }
        if (
            status === 400 ||
            status === 422 ||
            (status >= 400 && status < 500 && blob.indexOf('content') !== -1) ||
            blob.indexOf('problems parsing') !== -1 ||
            blob.indexOf('invalid request') !== -1
        ) {
            return (
                'GitHub rejected the publish request. Update DonkeyCODE to a build that forwards GM_xmlhttpRequest ' +
                '`data` / `body` into fetch(), set Content-Type: application/json, and use a PAT with Contents write. ' +
                '(HTTP ' + status + (msg ? ': ' + msg : '') + ')'
            );
        }
        if (status === 0 || !status) {
            return (
                'Request failed (HTTP 0). Enable DonkeyCODE optional site access (http(s)://*/*), check @connect, ' +
                'and inspect the extension service worker console for GM_XHR errors.'
            );
        }
        return 'HTTP ' + status + (msg ? ': ' + msg : '');
    }

    /**
     * DonkeyCODE: pass `data` (string or object; bridge may stringify objects) and set
     * Content-Type for GitHub REST JSON bodies. See SCRIPT_STANDARD_PLAN.md GM_xhr section.
     */
    function githubXhr(method, url, bodyObj, cb, logLine) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            if (typeof logLine === 'function') {
                logLine('GM_xmlhttpRequest not available (grant @grant GM_xmlhttpRequest in DonkeyCODE).');
            }
            cb(0, '');
            return;
        }
        var headers = githubApiHeaders();
        var hasBody = bodyObj !== undefined && bodyObj !== null;
        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        }
        var payload = undefined;
        if (hasBody) {
            payload = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
        }
        if (typeof logLine === 'function') {
            logLine('GM_xhr: ' + method + ' ' + url + (hasBody ? ' (with body)' : ' (no body field — GET must not send data)'));
        }
        var req = {
            method: method,
            url: url,
            headers: headers,
            onload: function (res) {
                var st = (res && res.status) || 0;
                if (typeof logLine === 'function') {
                    var rt = (res && res.responseText) || '';
                    logLine('GM_xhr onload: HTTP ' + st + (rt ? ', body len ' + String(rt).length : ''));
                }
                cb(st, (res && res.responseText) || '');
            },
            onerror: function (res) {
                if (typeof logLine === 'function') {
                    var s = res && res.status;
                    var t = res && res.statusText;
                    logLine('GM_xhr onerror' + (s != null ? ' status=' + s : '') + (t ? ' ' + t : '') + ' — network/CORS/bridge. Check @connect api.github.com + DonkeyCODE host access for api.github.com.');
                }
                cb(0, '');
            },
            ontimeout: function () {
                if (typeof logLine === 'function') {
                    logLine('GM_xhr ontimeout — request to api.github.com did not complete.');
                }
                cb(0, '');
            },
            timeout: 60000
        };
        if (hasBody) {
            req.data = payload;
        }
        GM_xmlhttpRequest(req);
    }

    function githubGetFile(cb, logDebug) {
        var branch = encodeURIComponent(resolvedWallOfFameDataBranch());
        var url = githubContentsApiUrl() + '?ref=' + branch;
        githubXhr(
            'GET',
            url,
            null,
            function (status, text) {
            if (typeof logDebug === 'function') {
                logDebug('Contents API GET HTTP ' + status + ' — ' + url);
            }
            if (status === 404) {
                githubFileSha = null;
                if (typeof logDebug === 'function') {
                    logDebug('Contents: file not at path (HTTP 404) — check wallOfFameRepoPath / branch / repo.');
                }
                cb(null, null);
                return;
            }
            if (status < 200 || status >= 300) {
                if (typeof logDebug === 'function') {
                    if (status === 0) {
                        logDebug('Contents GET failed (HTTP 0): no response — see GM_xhr lines above; @connect api.github.com, host permission for api.github.com.');
                    } else {
                        var errSum = '';
                        try {
                            var er = JSON.parse(text || '{}');
                            if (er && er.message) {
                                errSum = ' — ' + String(er.message).slice(0, 200);
                            }
                        } catch (e1) {}
                        logDebug('Contents GET error HTTP ' + status + errSum);
                    }
                }
                cb(null, null);
                return;
            }
            try {
                var meta = JSON.parse(text);
                githubFileSha = meta.sha || null;
                var raw = decodeGithubFileContent(meta.content || '');
                var entries = parseEntriesFromJsonText(raw);
                if (entries === null && typeof logDebug === 'function') {
                    logDebug('Contents: decoded JSON invalid (fix wall-of-fame.json in repo).');
                }
                cb(entries, githubFileSha);
            } catch (e) {
                if (typeof logDebug === 'function') {
                    logDebug('Contents: could not parse metadata JSON.');
                }
                cb(null, githubFileSha);
            }
        },
            logDebug
        );
    }

    function githubPutFile(entries, sha, cb) {
        var branch = resolvedWallOfFameDataBranch();
        var payload = {
            entries: entries,
            updatedAt: Date.now()
        };
        var bodyStr = JSON.stringify(payload, null, 2);
        var body = {
            message: 'Wall of Fame sync (DonkeyCODE)',
            content: utf8ToBase64(bodyStr),
            branch: branch
        };
        if (sha) {
            body.sha = sha;
        }
        var url = githubContentsApiUrl();
        githubXhr('PUT', url, body, function(status, text) {
            if (status === 200 || status === 201) {
                try {
                    var meta = JSON.parse(text);
                    if (meta.content && meta.content.sha) {
                        githubFileSha = meta.content.sha;
                    } else if (meta.commit && meta.commit.sha) {
                        githubFileSha = meta.commit.sha;
                    }
                } catch (e) {}
                cb(true, null);
                return;
            }
            if (status === 409) {
                cb(false, 'conflict');
                return;
            }
            cb(false, explainGithubPublishError(status, text));
        });
    }

    function isUnlocked() {
        try {
            return sessionStorage.getItem(SESSION_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function setUnlocked(ok) {
        try {
            if (ok) {
                sessionStorage.setItem(SESSION_KEY, '1');
            } else {
                sessionStorage.removeItem(SESSION_KEY);
            }
        } catch (e) {
            /* ignore */
        }
    }

    function normalizeEntry(e) {
        if (!e || typeof e !== 'object') {
            return null;
        }
        var id = String(e.id || '').trim() || ('wof-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
        return {
            id: id,
            title: String(e.title || '').trim() || 'Accolade',
            holder: String(e.holder || '').trim() || '—',
            note: String(e.note || '').trim(),
            sortOrder: Number.isFinite(Number(e.sortOrder)) ? Number(e.sortOrder) : 0,
            updatedAt: Number.isFinite(Number(e.updatedAt)) ? Number(e.updatedAt) : Date.now()
        };
    }

    function loadLocal() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (!raw) {
                return [];
            }
            var parsed = JSON.parse(raw);
            var arr = Array.isArray(parsed) ? parsed : (parsed.entries || []);
            if (!arr.length) {
                return [];
            }
            return arr.map(normalizeEntry).filter(Boolean);
        } catch (err) {
            return [];
        }
    }

    function saveLocal(entries) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(entries));
        } catch (e) {
            /* ignore */
        }
    }

    function mergeEntries(a, b) {
        a = a || [];
        b = b || [];
        var map = {};
        var i;
        for (i = 0; i < a.length; i++) {
            var ea = normalizeEntry(a[i]);
            if (ea) {
                map[ea.id] = ea;
            }
        }
        for (i = 0; i < b.length; i++) {
            var eb = normalizeEntry(b[i]);
            if (!eb) {
                continue;
            }
            var ex = map[eb.id];
            if (!ex || eb.updatedAt >= (ex.updatedAt || 0)) {
                map[eb.id] = eb;
            }
        }
        var out = [];
        var k;
        for (k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k)) {
                out.push(map[k]);
            }
        }
        out.sort(function(x, y) {
            return (x.sortOrder || 0) - (y.sortOrder || 0);
        });
        return out;
    }

    /**
     * Canonical list for GitHub PUT / dispatch / proxy: editor state wins (deletes stay deleted).
     * Reassigns sortOrder 1..n in display order.
     */
    function prepareEntriesForPublish(entries) {
        var list = (entries || [])
            .map(function(e) {
                return normalizeEntry(e);
            })
            .filter(Boolean);
        list.sort(function(a, b) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });
        var i;
        for (i = 0; i < list.length; i++) {
            list[i] = Object.assign({}, list[i], { sortOrder: i + 1 });
        }
        return list;
    }

    function wofReorderEntry(panel, entryId, delta) {
        var sorted = entriesState.slice().sort(function(a, b) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });
        var idx = -1;
        var i;
        for (i = 0; i < sorted.length; i++) {
            if (sorted[i].id === entryId) {
                idx = i;
                break;
            }
        }
        if (idx < 0) {
            return;
        }
        var ni = idx + delta;
        if (ni < 0 || ni >= sorted.length) {
            return;
        }
        var t = sorted[idx];
        sorted[idx] = sorted[ni];
        sorted[ni] = t;
        for (i = 0; i < sorted.length; i++) {
            var id = sorted[i].id;
            var j;
            for (j = 0; j < entriesState.length; j++) {
                if (entriesState[j].id === id) {
                    entriesState[j].sortOrder = i + 1;
                    break;
                }
            }
        }
        saveLocal(entriesState);
        var moved = sorted[ni];
        wofLogLocalDraft(
            panel,
            'reordered "' +
                (moved.title || moved.id) +
                '" ' +
                (delta < 0 ? 'up' : 'down') +
                ' — ' +
                entriesState.length +
                ' entr' +
                (entriesState.length === 1 ? 'y' : 'ies') +
                '. Use Publish to update GitHub.'
        );
        renderCards(panel);
    }

    function fetchCloud(cb, panel) {
        var log = function(m) {
            wofLogSyncLine(panel, m);
        };
        var owner = resolvedWallOfFameDataOwner();
        var repo = resolvedWallOfFameDataRepo();
        var branch = resolvedWallOfFameDataBranch();
        var path = resolvedGithubFilePath();
        var fetchMode =
            proxyConfigured()
                ? 'proxy'
                : githubConfigured() && wallOfFamePreferDirectContentsApi()
                  ? 'direct-Contents-only (pref)'
                  : actionsModeConfigured()
                    ? 'Actions: raw then API if needed'
                    : githubConfigured()
                      ? 'direct API'
                      : 'no PAT';
        log(
            'Fetch start — repo ' +
                owner +
                '/' +
                repo +
                '@' +
                branch +
                ', path: ' +
                path +
                ' — ' +
                fetchMode
        );
        if (githubConfigured() && wallOfFamePreferDirectContentsApi() && !proxyConfigured()) {
            log('Using Contents API GET only (PAT + wallOfFamePreferDirectContentsApi).');
            githubGetFile(
                function (entries) {
                    if (entries === null) {
                        log('Contents API GET failed — check PAT, path, branch, wallOfFameDataOwner/Repo.');
                    } else {
                        log('Contents API: ' + entries.length + ' entries.');
                    }
                    cb(entries);
                },
                log
            );
            return;
        }
        if (proxyConfigured()) {
            log('GET via proxy ' + String(proxyBaseUrl() || '').replace(/\/+$/, '') + '/wall-of-fame');
            proxyGetFile(function(ent) {
                if (ent === null) {
                    log('Proxy: failed (HTTP not 2xx, bad JSON, or network).');
                } else {
                    log('Proxy: OK, ' + ent.length + ' entr' + (ent.length === 1 ? 'y' : 'ies') + '.');
                }
                cb(ent);
            });
            return;
        }
        if (actionsModeConfigured()) {
            rawGithubGet(function(entries) {
                if (entries !== null) {
                    log('Using raw result: ' + entries.length + ' entries.');
                    cb(entries);
                    return;
                }
                if (githubConfigured()) {
                    log('Raw failed or private; trying Contents API with PAT…');
                    githubGetFile(
                        function(e2) {
                            if (e2 === null) {
                                log('Contents API fetch failed — see lines above.');
                            } else {
                                log('Contents API: ' + e2.length + ' entries.');
                            }
                            cb(e2);
                        },
                        log
                    );
                    return;
                }
                log('No PAT: cannot fall back to Contents API for private repo. Set donkeycode_github_pat.');
                cb(null);
            }, log);
            return;
        }
        if (!githubConfigured()) {
            log('No donkeycode_github_pat — cannot GET private file. Public raw only works if actions+raw path is used; for direct mode set PAT.');
            cb(null);
            return;
        }
        githubGetFile(
            function(entries) {
                if (entries === null) {
                    log('Direct Contents GET failed — check PAT scope (Contents read) and path.');
                } else {
                    log('Direct Contents: ' + entries.length + ' entries.');
                }
                cb(entries);
            },
            log
        );
    }

    function postCloud(entries, cb, panelOpt) {
        var panel = panelOpt || document.getElementById(PANEL_ID);
        var owner = resolvedWallOfFameDataOwner();
        var repo = resolvedWallOfFameDataRepo();
        var branch = resolvedWallOfFameDataBranch();
        var path = resolvedGithubFilePath();
        var mode = proxyConfigured()
            ? 'proxy'
            : githubConfigured() && wallOfFamePreferDirectContentsApi()
              ? 'contents'
              : actionsModeConfigured()
                ? 'actions'
                : 'contents';

        wofAppendPublishLog(panel, 'Publish start — mode: ' + mode + ', repo: ' + owner + '/' + repo + '@' + branch + ', path: ' + path);
        if (mode === 'actions') {
            wofAppendPublishLog(
                panel,
                'Actions: POST /repos/' + owner + '/' + repo + '/dispatches (needs repo scope + workflow scope on PAT if GitHub requires it)'
            );
        } else if (mode === 'contents') {
            wofAppendPublishLog(
                panel,
                (githubConfigured() && wallOfFamePreferDirectContentsApi() ? 'Direct Contents API (pref): ' : 'Direct: ') +
                    'PUT api.github.com/contents/… (PAT needs Contents write on ' +
                    owner +
                    '/' +
                    repo +
                    ')'
            );
        }

        function wofPublishDbg(m) {
            wofAppendPublishLog(panel, m);
        }
        function doGithubPut() {
            wofAppendPublishLog(panel, 'GET file metadata + SHA…');
            githubGetFile(
                function(remote, sha) {
                if (remote === null && sha === null) {
                    wofAppendPublishLog(panel, 'Note: file missing or GET failed (HTTP not 2xx). Attempting create/update anyway.');
                } else {
                    wofAppendPublishLog(panel, 'Remote entries: ' + (remote ? remote.length : 0) + ', sha: ' + (sha ? sha.slice(0, 7) + '…' : '(new file)'));
                }
                var toSave = prepareEntriesForPublish(entries);
                wofAppendPublishLog(
                    panel,
                    'PUT local list (' +
                        toSave.length +
                        ' entries; deletions are not restored from remote).'
                );
                entriesState = toSave;
                saveLocal(entriesState);
                if (panel) {
                    render(panel);
                }
                githubPutFile(toSave, sha, function(ok, err) {
                    if (ok) {
                        wofAppendPublishLog(panel, 'PUT succeeded (HTTP 200/201).');
                        cb(true, null);
                        return;
                    }
                    if (err === 'conflict') {
                        wofAppendPublishLog(panel, '409 conflict — refetching SHA and retrying once…');
                        githubGetFile(
                            function(remote2, sha2) {
                            var retryPayload = prepareEntriesForPublish(entriesState);
                            entriesState = retryPayload;
                            saveLocal(entriesState);
                            if (panel) {
                                render(panel);
                            }
                            githubPutFile(retryPayload, sha2, function(ok2, err2) {
                                if (ok2) {
                                    wofAppendPublishLog(panel, 'Retry PUT succeeded.');
                                } else {
                                    wofAppendPublishLog(panel, 'Retry failed: ' + (err2 || ''));
                                }
                                cb(ok2, err2 || null);
                            });
                        },
                        wofPublishDbg
                        );
                        return;
                    }
                    wofAppendPublishLog(panel, 'PUT error: ' + (err || ''));
                    cb(false, err || 'GitHub PUT failed');
                });
            },
            wofPublishDbg
            );
        }

        if (proxyConfigured()) {
            wofAppendPublishLog(panel, 'GET via proxy (for conflict check only)…');
            proxyGetFile(function(remote) {
                var toSave = prepareEntriesForPublish(entries);
                wofAppendPublishLog(panel, 'PUT local list: ' + toSave.length + ' entries.');
                entriesState = toSave;
                saveLocal(entriesState);
                if (panel) {
                    render(panel);
                }
                var doc = {
                    entries: toSave,
                    updatedAt: Date.now()
                };
                wofAppendPublishLog(panel, 'PUT via proxy…');
                proxyPutDocument(doc, function(ok, err) {
                    if (ok) {
                        wofAppendPublishLog(panel, 'Proxy PUT OK.');
                        cb(true, null);
                        return;
                    }
                    if (err === 'conflict') {
                        wofAppendPublishLog(panel, 'Proxy conflict — retry with fresh SHA…');
                        proxyGetFile(function(remote2) {
                            var retryPayload = prepareEntriesForPublish(entriesState);
                            entriesState = retryPayload;
                            saveLocal(entriesState);
                            if (panel) {
                                render(panel);
                            }
                            proxyPutDocument(
                                { entries: retryPayload, updatedAt: Date.now() },
                                function(ok2, err2) {
                                    if (!ok2) {
                                        wofAppendPublishLog(panel, 'Retry: ' + (err2 || ''));
                                    }
                                    cb(ok2, err2 || null);
                                }
                            );
                        });
                        return;
                    }
                    wofAppendPublishLog(panel, 'Proxy error: ' + (err || ''));
                    cb(false, err || 'Proxy publish failed');
                });
            });
            return;
        }

        if (githubConfigured() && wallOfFamePreferDirectContentsApi()) {
            wofAppendPublishLog(
                panel,
                'Using direct Contents API PUT (wallOfFamePreferDirectContentsApi) — not repository_dispatch.'
            );
            doGithubPut();
            return;
        }

        if (actionsModeConfigured()) {
            if (!actionsPublishConfigured()) {
                var msg =
                    'Actions mode: set donkeycode_github_pat (repo scope; add workflow if dispatch returns 403) and wallOfFameTeamKey must match WOF_TEAM_KEY.';
                wofAppendPublishLog(panel, msg);
                cb(false, msg);
                return;
            }
            rawGithubGet(
                function(remote) {
                if (remote === null && githubConfigured()) {
                    wofAppendPublishLog(panel, 'raw.githubusercontent.com failed; trying Contents API GET…');
                    githubGetFile(
                        function(r2) {
                        runActionsDispatch(r2 || []);
                    },
                    wofPublishDbg
                    );
                    return;
                }
                runActionsDispatch(remote || []);
            },
            wofPublishDbg
            );
            return;
        }

        function runActionsDispatch(remote) {
            var toSave = prepareEntriesForPublish(entries);
            wofAppendPublishLog(
                panel,
                'Dispatch: saving local list (' +
                    toSave.length +
                    ' entries). Remote had ' +
                    (remote ? remote.length : 0) +
                    ' — not merged (deletions preserved).'
            );
            entriesState = toSave;
            saveLocal(entriesState);
            if (panel) {
                render(panel);
            }
            var doc = {
                entries: toSave,
                updatedAt: Date.now()
            };
            wofAppendPublishLog(panel, 'POST repository_dispatch (event wall-of-fame-put), payload entries: ' + toSave.length);
            githubRepositoryDispatch(doc, function(ok, err) {
                if (ok) {
                    wofAppendPublishLog(panel, 'Dispatch accepted (HTTP 204). Check Actions tab on GitHub.');
                    cb(true, null);
                    return;
                }
                var detail = err || 'repository_dispatch failed';
                if (String(detail).indexOf('403') !== -1) {
                    detail +=
                        ' — PAT may need workflow scope, or enable workflow permissions for GITHUB_TOKEN in repo Settings → Actions.';
                }
                wofAppendPublishLog(panel, 'Dispatch failed: ' + detail);
                cb(false, detail);
            });
        }

        if (!githubConfigured()) {
            var need =
                'Set donkeycode_github_pat in DonkeyCODE, or enable proxy URL + key, or Actions + team key + PAT.';
            wofAppendPublishLog(panel, need);
            cb(false, need);
            return;
        }
        doGithubPut();
    }

    /**
     * FIMS tab content lives in a sidebar segment; mount the panel there so it fills
     * the area (structural match — no dependency on obfuscated class suffixes).
     */
    function findFimsTabSegmentHost(tableEl) {
        if (!tableEl || typeof tableEl.closest !== 'function') {
            return null;
        }
        var t =
            tableEl.closest('#mainApp .pushable .sidebar .ui.bottom.attached.segment') ||
            tableEl.closest('#mainApp .sidebar .ui.bottom.attached.segment') ||
            tableEl.closest('#mainApp .ui.segment.bottom.attached.tab') ||
            tableEl.closest('#mainApp .ui.bottom.attached.segment');
        return t || null;
    }

    function mountPanelInFimsTabSegment(panel, tableEl) {
        if (!panel || !tableEl) {
            return;
        }
        var host = findFimsTabSegmentHost(tableEl);
        if (!host) {
            return;
        }
        if (panel.parentNode !== host) {
            host.appendChild(panel);
        }
        host.style.display = 'flex';
        host.style.flexDirection = 'column';
        host.style.flex = '1 1 auto';
        host.style.minHeight = '0';
        host.style.overflow = 'hidden';
        panel.style.flex = '1 1 auto';
        panel.style.minHeight = '0';
        panel.style.maxHeight = 'none';
        panel.style.width = '100%';
        panel.style.boxSizing = 'border-box';
        panel.style.alignSelf = 'stretch';
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var css = [
            '#' + PANEL_ID + '{display:none;flex-direction:column;padding:0;width:100%;box-sizing:border-box;min-height:0;',
            'flex:1 1 auto;',
            'background:radial-gradient(ellipse 120% 80% at 50% -20%,rgba(120,60,180,.25) 0%,transparent 50%),',
            'radial-gradient(ellipse 80% 50% at 100% 100%,rgba(255,180,80,.08) 0%,transparent 45%),',
            'linear-gradient(165deg,#120a18 0%,#1e1432 35%,#152238 70%,#0d1528 100%);',
            'border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,215,0,.12);',
            'border:1px solid rgba(255,215,0,.22);overflow:hidden;position:relative;}',
            '#' + PANEL_ID + ' .dc-wof-inner{padding:18px 20px 20px;color:#f5eefc;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
            'width:100%;max-width:none;box-sizing:border-box;position:relative;z-index:1;',
            'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}',
            '#' + PANEL_ID + ' .dc-wof-h{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px;padding-bottom:14px;',
            'border-bottom:1px solid rgba(255,215,0,.2);background:linear-gradient(180deg,rgba(255,215,0,.06) 0%,transparent 100%);',
            'border-radius:8px 8px 0 0;margin:-4px -4px 18px;padding:12px 12px 14px;}',
            '#' + PANEL_ID + ' .dc-wof-head-actions{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;}',
            '#' + PANEL_ID + ' .dc-wof-edit-toggle{font-size:11px;padding:6px 12px;border-radius:999px;border:1px solid rgba(255,215,0,.5);',
            'background:linear-gradient(180deg,rgba(255,215,0,.2),rgba(255,180,60,.08));color:#fff6d4;cursor:pointer;font-weight:600;',
            'box-shadow:0 2px 8px rgba(0,0,0,.25);}',
            '#' + PANEL_ID + ' .dc-wof-edit-toggle:hover{background:linear-gradient(180deg,rgba(255,230,140,.28),rgba(255,200,80,.15));}',
            '#' + PANEL_ID + ' .dc-wof-head-emoji{font-size:1.85rem;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));}',
            '#' + PANEL_ID + ' .dc-wof-title{font-weight:800;font-size:1.35rem;letter-spacing:.02em;',
            'background:linear-gradient(92deg,#fff4c4 0%,#ffd24a 25%,#ffb020 50%,#e8a8ff 100%);',
            '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;',
            'filter:drop-shadow(0 2px 12px rgba(255,200,80,.25));}',
            '#' + PANEL_ID + ' .dc-wof-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:16px;',
            'flex:1 1 auto;min-height:0;overflow:auto;padding:6px 4px 8px;}',
            '#' + PANEL_ID + ' .dc-wof-card{position:relative;min-height:118px;display:flex;flex-direction:column;',
            'padding:14px 14px 12px;margin-top:2px;',
            'background:linear-gradient(155deg,rgba(55,32,72,.92) 0%,rgba(28,18,48,.96) 48%,rgba(22,28,52,.94) 100%);',
            'border-radius:6px 6px 14px 14px;',
            'border:1px solid rgba(255,215,0,.35);',
            'box-shadow:0 8px 28px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.1),0 0 0 1px rgba(0,0,0,.2),',
            'inset 0 -2px 20px rgba(255,200,60,.06);',
            'overflow:hidden;transition:transform .2s ease,box-shadow .2s ease;}',
            '#' + PANEL_ID + ' .dc-wof-card:hover{transform:translateY(-2px);',
            'box-shadow:0 14px 36px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.14),0 0 0 1px rgba(255,215,0,.25),',
            '0 0 32px rgba(255,190,80,.12);}',
            '#' + PANEL_ID + ' .dc-wof-card::before{content:"";position:absolute;left:0;right:0;top:0;height:5px;',
            'background:linear-gradient(90deg,#5c4a1a 0%,#d4a017 18%,#ffe9a8 50%,#d4a017 82%,#5c4a1a 100%);',
            'box-shadow:0 2px 8px rgba(255,200,80,.35);}',
            '#' + PANEL_ID + ' .dc-wof-card::after{content:"";position:absolute;inset:5px 10px auto 10px;height:1px;',
            'background:linear-gradient(90deg,transparent,rgba(255,215,0,.25),transparent);opacity:.9;}',
            '#' + PANEL_ID + ' .dc-wof-card-rank{position:absolute;top:10px;right:10px;font-size:.65rem;font-weight:800;',
            'letter-spacing:.08em;color:rgba(255,228,160,.95);text-shadow:0 1px 2px rgba(0,0,0,.5);',
            'background:rgba(0,0,0,.35);padding:3px 8px;border-radius:999px;border:1px solid rgba(255,215,0,.35);}',
            '#' + PANEL_ID + ' .dc-wof-card-t{font-size:.62rem;text-transform:uppercase;letter-spacing:.14em;font-weight:700;',
            'color:#d4b8f0;margin:8px 56px 8px 0;opacity:.95;}',
            '#' + PANEL_ID + ' .dc-wof-card-h{font-family:Georgia,"Palatino Linotype","Book Antiqua",Palatino,serif;font-weight:700;font-size:1.08rem;',
            'color:#fffef8;line-height:1.35;margin-bottom:2px;text-shadow:0 2px 8px rgba(0,0,0,.4);}',
            '#' + PANEL_ID + ' .dc-wof-card-n{margin-top:10px;font-size:1.02rem;font-weight:700;',
            'background:linear-gradient(90deg,#ffe8a0,#ffd24a,#ffc050);-webkit-background-clip:text;background-clip:text;',
            '-webkit-text-fill-color:transparent;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));}',
            '#' + PANEL_ID + ' .dc-wof-card-note{margin-top:10px;padding:8px 10px;font-size:.78rem;font-style:italic;',
            'color:#d8cce8;border-left:3px solid rgba(255,200,100,.45);background:rgba(0,0,0,.22);border-radius:0 8px 8px 0;}',
            '#' + PANEL_ID + ' .dc-wof-card-empty{background:transparent!important;border:1px dashed rgba(255,215,0,.2)!important;box-shadow:none!important;}',
            '#' + PANEL_ID + ' .dc-wof-card-empty::before,#' + PANEL_ID + ' .dc-wof-card-empty::after{display:none;}',
            '#' + PANEL_ID + ' .dc-wof-card-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:12px;',
            'border-top:1px solid rgba(255,255,255,.08);}',
            '#' + PANEL_ID + ' .dc-wof-card-actions button{font-size:11px;padding:5px 9px;border-radius:6px;border:1px solid rgba(255,255,255,.22);',
            'background:rgba(0,0,0,.28);color:#f0e8ff;cursor:pointer;transition:background .15s;}',
            '#' + PANEL_ID + ' .dc-wof-card-actions button:hover{background:rgba(255,215,0,.12);}',
            '#' + PANEL_ID + ' .dc-wof-card-actions button.dc-wof-card-del{border-color:rgba(255,140,140,.45);color:#ffc8c8;}',
            '#' + PANEL_ID + ' .dc-wof-edit{display:none;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12);}',
            '#' + PANEL_ID + ' .dc-wof-edit label{display:block;font-size:.72rem;opacity:.85;margin-bottom:4px;}',
            '#' + PANEL_ID + ' .dc-wof-edit input,.dc-wof-edit textarea{width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:#fff;margin-bottom:8px;font-size:13px;}',
            '#' + PANEL_ID + ' .dc-wof-edit textarea{min-height:52px;resize:vertical;}',
            '#' + PANEL_ID + ' .dc-wof-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;}',
            '#' + PANEL_ID + ' .dc-wof-btns button{padding:8px 12px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:600;}',
            '#' + PANEL_ID + ' .dc-wof-btn-gold{background:linear-gradient(135deg,#b8860b,#ffd700);color:#2a1a00;}',
            '#' + PANEL_ID + ' .dc-wof-btn-sec{background:rgba(255,255,255,.12);color:#eee;}',
            '#' + PANEL_ID + ' .dc-wof-list{margin:8px 0 0;padding-left:1.1em;font-size:.8rem;opacity:.9;}',
            '#' + PANEL_ID + ' .dc-wof-hint{font-size:.65rem;opacity:.6;margin-top:10px;line-height:1.4;}',
            '#' + PANEL_ID + ' #dc-wof-publish-log{display:block;width:100%;min-height:64px;max-height:180px;overflow:auto;margin-top:10px;padding:8px;',
            'font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;white-space:pre-wrap;word-break:break-word;',
            'background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#c8e0ff;}'
        ].join('');
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    }

    var entriesState = loadLocal();

    function renderCards(panel) {
        var grid = panel.querySelector('.dc-wof-grid');
        if (!grid) {
            return;
        }
        grid.innerHTML = '';
        var list = entriesState.slice().sort(function(a, b) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });
        var showCardActions = editPanelOpen && isUnlocked();
        if (list.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'dc-wof-card dc-wof-card-empty';
            empty.style.opacity = '0.85';
            empty.style.fontStyle = 'italic';
            empty.style.padding = '24px';
            empty.style.textAlign = 'center';
            empty.textContent =
                'No accolades yet. Use Fetch from GitHub after configuring sync, or unlock Edit to add entries.';
            grid.appendChild(empty);
            return;
        }
        var i;
        var nList = list.length;
        for (i = 0; i < list.length; i++) {
            (function(ent, pos) {
                var e = ent;
                var card = document.createElement('div');
                card.className = 'dc-wof-card';
                card.dataset.entryId = e.id;
                var rank = document.createElement('div');
                rank.className = 'dc-wof-card-rank';
                rank.textContent = '#' + (pos + 1);
                card.appendChild(rank);
                var t = document.createElement('div');
                t.className = 'dc-wof-card-t';
                t.textContent = 'Hall of fame';
                var h = document.createElement('div');
                h.className = 'dc-wof-card-h';
                h.textContent = e.title;
                var n = document.createElement('div');
                n.className = 'dc-wof-card-n';
                n.textContent = e.holder;
                card.appendChild(t);
                card.appendChild(h);
                card.appendChild(n);
                if (e.note) {
                    var note = document.createElement('div');
                    note.className = 'dc-wof-card-note';
                    note.textContent = e.note;
                    card.appendChild(note);
                }

                if (showCardActions) {
                    var actions = document.createElement('div');
                    actions.className = 'dc-wof-card-actions';
                    var upBtn = document.createElement('button');
                    upBtn.type = 'button';
                    upBtn.className = 'dc-wof-btn-sec';
                    upBtn.textContent = 'Up';
                    upBtn.title = 'Move earlier in list';
                    upBtn.disabled = pos <= 0;
                    upBtn.addEventListener('click', function(ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        wofReorderEntry(panel, e.id, -1);
                    });
                    var downBtn = document.createElement('button');
                    downBtn.type = 'button';
                    downBtn.className = 'dc-wof-btn-sec';
                    downBtn.textContent = 'Down';
                    downBtn.title = 'Move later in list';
                    downBtn.disabled = pos >= nList - 1;
                    downBtn.addEventListener('click', function(ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        wofReorderEntry(panel, e.id, 1);
                    });
                    actions.appendChild(upBtn);
                    actions.appendChild(downBtn);
                    var editBtn = document.createElement('button');
                    editBtn.type = 'button';
                    editBtn.className = 'dc-wof-btn-sec';
                    editBtn.textContent = wofEditingId === e.id ? 'Cancel edit' : 'Edit';
                    editBtn.addEventListener('click', function(ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        wofEditingId = wofEditingId === e.id ? null : e.id;
                        renderCards(panel);
                    });
                    var delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'dc-wof-card-del';
                    delBtn.textContent = 'Delete';
                    delBtn.addEventListener('click', function(ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (!confirm('Remove this accolade?')) {
                            return;
                        }
                        if (wofEditingId === e.id) {
                            wofEditingId = null;
                        }
                        var removedTitle = e.title || e.id;
                        entriesState = entriesState.filter(function(x) {
                            return x.id !== e.id;
                        });
                        saveLocal(entriesState);
                        wofLogLocalDraft(
                            panel,
                            'deleted "' +
                                removedTitle +
                                '" — ' +
                                entriesState.length +
                                ' entr' +
                                (entriesState.length === 1 ? 'y' : 'ies') +
                                ' left. Use Publish to remove from repo.'
                        );
                        renderCards(panel);
                    });
                    actions.appendChild(editBtn);
                    actions.appendChild(delBtn);
                    card.appendChild(actions);
                }

                if (showCardActions && wofEditingId === e.id) {
                    var labT = document.createElement('label');
                    labT.style.fontSize = '0.72rem';
                    labT.style.opacity = '0.85';
                    labT.style.display = 'block';
                    labT.style.marginTop = '8px';
                    labT.textContent = 'Title';
                    var inT = document.createElement('input');
                    inT.type = 'text';
                    inT.value = e.title;
                    inT.setAttribute('autocomplete', 'off');
                    inT.setAttribute('data-lpignore', 'true');
                    inT.style.width = '100%';
                    inT.style.boxSizing = 'border-box';
                    inT.style.marginBottom = '6px';
                    var labH = document.createElement('label');
                    labH.style.fontSize = '0.72rem';
                    labH.style.opacity = '0.85';
                    labH.style.display = 'block';
                    labH.textContent = 'Holder';
                    var inH = document.createElement('input');
                    inH.type = 'text';
                    inH.value = e.holder;
                    inH.setAttribute('autocomplete', 'off');
                    inH.setAttribute('data-lpignore', 'true');
                    inH.style.width = '100%';
                    inH.style.boxSizing = 'border-box';
                    inH.style.marginBottom = '6px';
                    var labN = document.createElement('label');
                    labN.style.fontSize = '0.72rem';
                    labN.style.opacity = '0.85';
                    labN.style.display = 'block';
                    labN.textContent = 'Note (optional)';
                    var inN = document.createElement('input');
                    inN.type = 'text';
                    inN.value = e.note || '';
                    inN.setAttribute('autocomplete', 'off');
                    inN.setAttribute('data-lpignore', 'true');
                    inN.style.width = '100%';
                    inN.style.boxSizing = 'border-box';
                    inN.style.marginBottom = '6px';
                    var row = document.createElement('div');
                    row.className = 'dc-wof-btns';
                    row.style.marginTop = '4px';
                    var saveBtn = document.createElement('button');
                    saveBtn.type = 'button';
                    saveBtn.className = 'dc-wof-btn-gold';
                    saveBtn.textContent = 'Save';
                    saveBtn.addEventListener('click', function(ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        var title = inT.value.trim();
                        var holder = inH.value.trim();
                        if (!title || !holder) {
                            alert('Title and holder are required.');
                            return;
                        }
                        var j;
                        for (j = 0; j < entriesState.length; j++) {
                            if (entriesState[j].id === e.id) {
                                entriesState[j] = normalizeEntry({
                                    id: e.id,
                                    title: title,
                                    holder: holder,
                                    note: inN.value.trim(),
                                    sortOrder: entriesState[j].sortOrder,
                                    updatedAt: Date.now()
                                });
                                break;
                            }
                        }
                        saveLocal(entriesState);
                        wofLogLocalDraft(
                            panel,
                            'saved card "' +
                                title +
                                '" / ' +
                                holder +
                                '. Use Publish to update repo.'
                        );
                        wofEditingId = null;
                        renderCards(panel);
                    });
                    var cancelBtn = document.createElement('button');
                    cancelBtn.type = 'button';
                    cancelBtn.className = 'dc-wof-btn-sec';
                    cancelBtn.textContent = 'Cancel';
                    cancelBtn.addEventListener('click', function(ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        wofEditingId = null;
                        renderCards(panel);
                    });
                    row.appendChild(saveBtn);
                    row.appendChild(cancelBtn);
                    card.appendChild(labT);
                    card.appendChild(inT);
                    card.appendChild(labH);
                    card.appendChild(inH);
                    card.appendChild(labN);
                    card.appendChild(inN);
                    card.appendChild(row);
                }

                grid.appendChild(card);
            })(list[i], i);
        }
    }

    function syncEditPanelVisibility(panel) {
        var wrap = panel.querySelector('.dc-wof-edit');
        var btn = panel.querySelector('.dc-wof-edit-toggle');
        var pubLog = panel.querySelector('#dc-wof-publish-log');
        if (wrap) {
            wrap.style.display = editPanelOpen ? 'block' : 'none';
        }
        if (pubLog) {
            pubLog.style.display = 'block';
        }
        if (btn) {
            btn.textContent = editPanelOpen ? 'Hide editor' : 'Edit';
            btn.setAttribute('aria-expanded', editPanelOpen ? 'true' : 'false');
        }
        if (!editPanelOpen) {
            wofEditingId = null;
        }
        if (panel) {
            renderCards(panel);
        }
    }

    function renderEditSection(panel) {
        var wrap = panel.querySelector('.dc-wof-edit');
        if (!wrap) {
            return;
        }
        wrap.innerHTML = '';
        var unlocked = isUnlocked();

        if (!unlocked) {
            var p1 = document.createElement('p');
            p1.style.fontSize = '0.85rem';
            p1.style.opacity = '0.9';
            p1.textContent = 'Enter the editor password to add or remove accolades. Use Fetch / Publish to sync with GitHub when a PAT is set.';
            var lab = document.createElement('label');
            lab.textContent = 'Password';
            var inp = document.createElement('input');
            inp.type = 'password';
            inp.setAttribute('autocomplete', 'new-password');
            inp.setAttribute('data-lpignore', 'true');
            inp.setAttribute('data-form-type', 'other');
            inp.placeholder = 'Password';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dc-wof-btn-gold';
            btn.textContent = 'Unlock';
            btn.addEventListener('click', function(ev) {
                ev.preventDefault();
                if (inp.value === EDIT_PASSWORD) {
                    setUnlocked(true);
                    wofEditingId = null;
                    renderCards(panel);
                    renderEditSection(panel);
                } else {
                    alert('Incorrect password.');
                }
            });
            wrap.appendChild(p1);
            wrap.appendChild(lab);
            wrap.appendChild(inp);
            wrap.appendChild(btn);
            return;
        }

        var lockBtn = document.createElement('button');
        lockBtn.type = 'button';
        lockBtn.className = 'dc-wof-btn-sec';
        lockBtn.textContent = 'Lock editor';
        lockBtn.addEventListener('click', function(ev) {
            ev.preventDefault();
            setUnlocked(false);
            editPanelOpen = false;
            wofEditingId = null;
            renderCards(panel);
            renderEditSection(panel);
        });
        wrap.appendChild(lockBtn);

        var la = document.createElement('label');
        la.textContent = 'Accolade title';
        var ta = document.createElement('input');
        ta.type = 'text';
        ta.setAttribute('autocomplete', 'off');
        ta.setAttribute('autocorrect', 'off');
        ta.setAttribute('autocapitalize', 'off');
        ta.setAttribute('spellcheck', 'false');
        ta.setAttribute('data-lpignore', 'true');
        ta.setAttribute('data-form-type', 'other');
        ta.placeholder = 'e.g. Most holds (PHX)';
        var lb = document.createElement('label');
        lb.textContent = 'Holder name';
        var tb = document.createElement('input');
        tb.type = 'text';
        tb.setAttribute('autocomplete', 'off');
        tb.setAttribute('autocorrect', 'off');
        tb.setAttribute('autocapitalize', 'off');
        tb.setAttribute('spellcheck', 'false');
        tb.setAttribute('data-lpignore', 'true');
        tb.setAttribute('data-form-type', 'other');
        tb.placeholder = 'Name';
        var lc = document.createElement('label');
        lc.textContent = 'Note (optional)';
        var tc = document.createElement('input');
        tc.type = 'text';
        tc.setAttribute('autocomplete', 'off');
        tc.setAttribute('autocorrect', 'off');
        tc.setAttribute('autocapitalize', 'off');
        tc.setAttribute('spellcheck', 'false');
        tc.setAttribute('data-lpignore', 'true');
        tc.setAttribute('data-form-type', 'other');
        tc.placeholder = 'Station, context, etc.';

        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'dc-wof-btn-gold';
        addBtn.textContent = 'Add accolade';
        addBtn.addEventListener('click', function(ev) {
            ev.preventDefault();
            var title = ta.value.trim();
            var holder = tb.value.trim();
            if (!title || !holder) {
                alert('Title and holder are required.');
                return;
            }
            var ent = normalizeEntry({
                id: 'wof-' + Date.now(),
                title: title,
                holder: holder,
                note: tc.value.trim(),
                sortOrder: entriesState.length + 1,
                updatedAt: Date.now()
            });
            entriesState.push(ent);
            saveLocal(entriesState);
            wofLogLocalDraft(
                panel,
                'added "' +
                    title +
                    '" / ' +
                    holder +
                    '. Use Publish to write to repo.'
            );
            ta.value = '';
            tb.value = '';
            tc.value = '';
            renderCards(panel);
        });

        wrap.appendChild(document.createElement('hr'));
        wrap.appendChild(la);
        wrap.appendChild(ta);
        wrap.appendChild(lb);
        wrap.appendChild(tb);
        wrap.appendChild(lc);
        wrap.appendChild(tc);
        wrap.appendChild(addBtn);

        var editHint = document.createElement('p');
        editHint.style.fontSize = '0.72rem';
        editHint.style.opacity = '0.8';
        editHint.style.marginTop = '10px';
        editHint.textContent =
            'Edit or delete entries on each card above (scroll up). Use Publish to push changes to GitHub.';
        wrap.appendChild(editHint);

        var pub = document.createElement('button');
        pub.type = 'button';
        pub.className = 'dc-wof-btn-sec';
        pub.textContent = 'Publish to GitHub';
        pub.title = proxyConfigured()
            ? 'Publish via team proxy (GitHub App on server)'
            : actionsModeConfigured()
              ? 'Trigger Actions workflow (repo secret WOF_TEAM_KEY + PAT to dispatch)'
              : 'PUT ' + resolvedGithubFilePath() + ' in ' + resolvedWallOfFameDataOwner() + '/' + resolvedWallOfFameDataRepo();
        pub.addEventListener('click', function(ev) {
            ev.preventDefault();
            if (!syncConfigured()) {
                alert(
                    'Enable: DonkeyCODE GitHub PAT, or Actions mode + team key + repo secret WOF_TEAM_KEY, or proxy URL + key.'
                );
                return;
            }
            wofClearPublishLog(panel);
            postCloud(entriesState, function(ok, err) {
                if (ok) {
                    alert('Published. See the debug log at the bottom of the panel.');
                } else {
                    wofAppendPublishLog(panel, 'FAILED: ' + (err || 'unknown'));
                    alert(
                        'Publish failed: ' +
                            (err || 'unknown') +
                            '\n\nSee the debug log at the bottom of this panel and the console [Wall of Fame].'
                    );
                }
            }, panel);
        });
        wrap.appendChild(pub);

        var imp = document.createElement('button');
        imp.type = 'button';
        imp.className = 'dc-wof-btn-sec';
        imp.textContent = 'Fetch from GitHub';
        imp.title = proxyConfigured()
            ? 'Fetch via team proxy'
            : actionsModeConfigured()
              ? 'Fetch from raw.githubusercontent.com (public) or Contents API if PAT set'
              : 'GET ' + resolvedGithubFilePath() + ' and merge (DonkeyCODE GitHub session sync settings)';
        imp.addEventListener('click', function(ev) {
            ev.preventDefault();
            if (!syncConfigured()) {
                alert('Turn on sync: GitHub PAT, Actions + team key, or proxy + team key.');
                return;
            }
            wofClearPublishLog(panel);
            wofAppendPublishLog(panel, 'Manual Fetch from GitHub (button)');
            fetchCloud(function(remote) {
                if (remote === null) {
                    wofAppendPublishLog(
                        panel,
                        'Fetch failed. Check log above, PAT, wallOfFameDataOwner/Repo/Branch, wallOfFameRepoPath, and console [Wall of Fame].'
                    );
                    alert(
                        'Could not load. Expand the debug log under the cards (or open Edit) and check console [Wall of Fame].'
                    );
                    return;
                }
                entriesState = mergeEntries(entriesState, remote);
                saveLocal(entriesState);
                renderCards(panel);
                wofAppendPublishLog(
                    panel,
                    'Fetch merged: ' + remote.length + ' entr' + (remote.length === 1 ? 'y' : 'ies') + ' from repo.'
                );
                alert('Merged from repo: ' + remote.length + ' entr' + (remote.length === 1 ? 'y' : 'ies') + '.');
            }, panel);
        });
        wrap.appendChild(imp);

        var hint = document.createElement('div');
        hint.className = 'dc-wof-hint';
        hint.textContent = proxyConfigured()
            ? 'Sync via team proxy (GitHub App on server). Local copy in localStorage. Add proxy host to @connect if needed.'
            : actionsModeConfigured() && !wallOfFamePreferDirectContentsApi()
              ? 'Actions + team key: raw + repository_dispatch. Turn off \u201cPrefer direct Contents API\u201d to use this when PAT is set.'
              : 'Default: GitHub Contents API GET/PUT with donkeycode_github_pat (wallOfFamePreferDirectContentsApi). Data repo: wallOfFameData*; local: localStorage.';
        wrap.appendChild(hint);

        syncEditPanelVisibility(panel);
    }

    function render(panel) {
        if (!panel) {
            return;
        }
        renderCards(panel);
        renderEditSection(panel);
    }

    function findTabMenu() {
        var menus = document.querySelectorAll('.ui.attached.tabular.menu');
        var i;
        for (i = 0; i < menus.length; i++) {
            var m = menus[i];
            var links = m.querySelectorAll('a.item');
            var j;
            for (j = 0; j < links.length; j++) {
                if ((links[j].textContent || '').indexOf('Advisories') !== -1) {
                    return { menu: m, advisoriesTab: links[j] };
                }
            }
        }
        return null;
    }

    function getSegments(menu) {
        var p = menu.parentElement;
        if (!p) {
            return [];
        }
        var out = [];
        var ch = p.children;
        var i;
        for (i = 0; i < ch.length; i++) {
            var el = ch[i];
            if (el.classList && el.classList.contains('ui') && el.classList.contains('bottom') && el.classList.contains('attached') && el.classList.contains('segment')) {
                out.push(el);
            }
        }
        return out;
    }

    function applyFimsIdAdvisoriesVisibility(hide) {
        var el = document.getElementById(TABLE_ID);
        if (!el) {
            return;
        }
        if (hide) {
            el.setAttribute(HIDE_FIMS_FOR_ADVIS_ATTR, '1');
            el.style.setProperty('display', 'none', 'important');
        } else {
            el.removeAttribute(HIDE_FIMS_FOR_ADVIS_ATTR);
            el.style.removeProperty('display');
        }
    }

    function showFimsTable() {
        var tab = document.getElementById(TAB_ID);
        if (tab) {
            tab.classList.remove('active');
        }
        var table = document.getElementById(TABLE_ID);
        var panel = document.getElementById(PANEL_ID);
        hideTopClickersPanel();
        applyFimsIdAdvisoriesVisibility(false);
        if (table) {
            table.style.display = '';
        }
        if (panel) {
            panel.style.display = 'none';
        }
    }

    /**
     * Native Advisories tab: FIMS #fims-id can share the same active segment as the
     * advisory MFE; hide the FIMS table (with !important) and our injected panels.
     */
    function onNativeAdvisoriesTabClick() {
        var tab = document.getElementById(TAB_ID);
        if (tab) {
            tab.classList.remove('active');
        }
        var panel = document.getElementById(PANEL_ID);
        hideTopClickersPanel();
        if (panel) {
            panel.style.display = 'none';
        }
        function refix() {
            applyFimsIdAdvisoriesVisibility(true);
        }
        refix();
        setTimeout(refix, 0);
        setTimeout(refix, 80);
        setTimeout(refix, 200);
    }

    var lastWofActivate = 0;

    /** Re-fetch wall-of-fame.json from GitHub when user opens the Wall of Fame tab (Contents API or proxy). */
    function refreshWallOfFameFromGitOnTab(panel) {
        if (!panel) {
            return;
        }
        if (!syncConfigured() && !githubConfigured()) {
            return;
        }
        wofLogSyncLine(panel, 'Tab focus: refreshing from repo…');
        fetchCloud(
            function (remote) {
                if (remote === null) {
                    wofLogSyncLine(panel, 'Tab refresh: fetch failed (see log above).');
                    return;
                }
                entriesState = mergeEntries(entriesState, remote);
                saveLocal(entriesState);
                render(panel);
                wofLogSyncLine(
                    panel,
                    'Tab refresh: merged ' + remote.length + ' entr' + (remote.length === 1 ? 'y' : 'ies') + ' from GitHub.'
                );
            },
            panel
        );
    }

    var menuTabMo = null;
    var menuTabDebounce = null;
    function scheduleMenuTabRepair() {
        if (menuTabDebounce) {
            clearTimeout(menuTabDebounce);
        }
        menuTabDebounce = setTimeout(function() {
            menuTabDebounce = null;
            if (!document.getElementById(TABLE_ID)) {
                return;
            }
            if (!getPref('wallOfFameShowTab', true)) {
                return;
            }
            if (!document.getElementById(TAB_ID) || !document.getElementById(PANEL_ID)) {
                ensureUi();
            }
        }, 80);
    }

    function wireMenuTabObserver(menu) {
        if (!menu || menu.dataset.dcWofMenuMo) {
            return;
        }
        menu.dataset.dcWofMenuMo = '1';
        if (menuTabMo) {
            menuTabMo.disconnect();
            menuTabMo = null;
        }
        menuTabMo = new MutationObserver(function() {
            scheduleMenuTabRepair();
        });
        /* childList only: subtree caused a flood of callbacks (class/text updates inside items)
         * and could freeze the page when combined with ensureUi(). */
        menuTabMo.observe(menu, { childList: true });
    }

    function showWallOfFame() {
        var now = Date.now();
        if (now - lastWofActivate < 120) {
            return;
        }
        lastWofActivate = now;

        ensureTab();
        ensurePanel();

        var found = findTabMenu();
        var tab = document.getElementById(TAB_ID);
        var table = document.getElementById(TABLE_ID);
        var panel = document.getElementById(PANEL_ID);
        if (!found || !tab || !table || !panel) {
            return;
        }
        var menu = found.menu;
        var items = menu.querySelectorAll('a.item');
        var i;
        for (i = 0; i < items.length; i++) {
            items[i].classList.remove('active');
        }
        tab.classList.add('active');
        var segments = getSegments(menu);
        if (segments.length >= 2) {
            segments[0].classList.add('active');
            segments[1].classList.remove('active');
        } else if (segments.length === 1) {
            segments[0].classList.add('active');
        }
        applyFimsIdAdvisoriesVisibility(false);
        hideTopClickersPanel();
        table.style.display = 'none';
        mountPanelInFimsTabSegment(panel, table);
        panel.style.display = 'flex';
        render(panel);
        refreshWallOfFameFromGitOnTab(panel);
    }

    /**
     * Document capture on **click**: preventDefault on mousedown does not cancel the click,
     * so the menu still handled the event and could remove our tabs or switch views.
     */
    var wofDocCaptureWired = false;
    function onWofDocCapture(e) {
        if (e.type !== 'click' || e.button !== 0) {
            return;
        }
        var t = e.target;
        if (!t || typeof t.closest !== 'function') {
            return;
        }
        if (!t.closest('#' + TAB_ID)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        showWallOfFame();
    }

    function wireWofTabCapture(tabEl) {
        if (!tabEl) {
            return;
        }
        if (!wofDocCaptureWired) {
            wofDocCaptureWired = true;
            document.addEventListener('click', onWofDocCapture, true);
        }
    }

    function wireTabs(menu) {
        if (!menu || menu.dataset.dcWofTabWire) {
            return;
        }
        menu.dataset.dcWofTabWire = '1';
        var links = menu.querySelectorAll('a.item');
        var j;
        for (j = 0; j < links.length; j++) {
            var link = links[j];
            if (link.id === TAB_ID) {
                continue;
            }
            if (link.id === 'dc-fims-top-clickers-host') {
                continue;
            }
            var txt = (link.textContent || '').replace(/\s+/g, ' ');
            if (txt.indexOf('FIMS') !== -1) {
                link.addEventListener('click', showFimsTable);
            } else if (txt.indexOf('Advisories') !== -1) {
                link.addEventListener('click', onNativeAdvisoriesTabClick);
            }
        }
    }

    function ensurePanel() {
        var existing = document.getElementById(PANEL_ID);
        if (existing) {
            var t0 = document.getElementById(TABLE_ID);
            if (t0) {
                mountPanelInFimsTabSegment(existing, t0);
            }
            return existing;
        }
        ensureStyles();
        var table = document.getElementById(TABLE_ID);
        if (!table || !table.parentNode) {
            return null;
        }
        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.display = 'none';

        var inner = document.createElement('div');
        inner.className = 'dc-wof-inner';

        var head = document.createElement('div');
        head.className = 'dc-wof-h';
        var ht = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'dc-wof-title';
        title.textContent = 'Wall of Fame';
        ht.appendChild(title);
        var actions = document.createElement('div');
        actions.className = 'dc-wof-head-actions';
        var editToggle = document.createElement('button');
        editToggle.type = 'button';
        editToggle.className = 'dc-wof-edit-toggle';
        editToggle.textContent = 'Edit';
        editToggle.setAttribute('aria-expanded', 'false');
        editToggle.title = 'Show or hide password and editor';
        editToggle.addEventListener('click', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            editPanelOpen = !editPanelOpen;
            syncEditPanelVisibility(panel);
        });
        var em = document.createElement('span');
        em.className = 'dc-wof-head-emoji';
        em.setAttribute('aria-hidden', 'true');
        em.textContent = '\u{1F3DB}\u{FE0F}';
        actions.appendChild(editToggle);
        actions.appendChild(em);
        head.appendChild(ht);
        head.appendChild(actions);
        inner.appendChild(head);

        var grid = document.createElement('div');
        grid.className = 'dc-wof-grid';
        inner.appendChild(grid);

        var edit = document.createElement('div');
        edit.className = 'dc-wof-edit';
        inner.appendChild(edit);

        var logCap = document.createElement('div');
        logCap.className = 'dc-wof-sync-log-cap';
        logCap.style.cssText = 'font-size:0.65rem;opacity:0.75;margin-top:8px;';
        logCap.textContent = 'Sync / publish log (Fetch + Publish write here; also console [Wall of Fame])';
        inner.appendChild(logCap);
        var pubLog = document.createElement('pre');
        pubLog.id = 'dc-wof-publish-log';
        pubLog.setAttribute('aria-label', 'Wall of Fame sync and publish debug log');
        inner.appendChild(pubLog);

        panel.appendChild(inner);
        table.parentNode.insertBefore(panel, table);
        mountPanelInFimsTabSegment(panel, table);

        entriesState = loadLocal();
        render(panel);

        if (syncConfigured()) {
            wofLogSyncLine(panel, 'Initial fetch on panel open (sync configured)…');
            fetchCloud(function(remote) {
                if (remote !== null) {
                    entriesState = mergeEntries(entriesState, remote);
                    saveLocal(entriesState);
                    render(panel);
                }
            }, panel);
        } else if (!entriesState.length) {
            /** Public repo: load from raw.githubusercontent.com without PAT / Actions / proxy. */
            wofLogSyncLine(panel, 'No PAT — trying public raw only (if repo/file is public)…');
            rawGithubGet(
                function(remote) {
                if (remote !== null && remote.length) {
                    entriesState = mergeEntries(entriesState, remote);
                    saveLocal(entriesState);
                    render(panel);
                }
            },
            function(m) {
                wofLogSyncLine(panel, m);
            }
            );
        }

        return panel;
    }

    function ensureTab() {
        if (!getPref('wallOfFameShowTab', true)) {
            return null;
        }
        var existing = document.getElementById(TAB_ID);
        if (existing) {
            wireWofTabCapture(existing);
            var foundExisting = findTabMenu();
            if (foundExisting && foundExisting.menu) {
                wireMenuTabObserver(foundExisting.menu);
            }
            return existing;
        }
        var found = findTabMenu();
        if (!found) {
            return null;
        }
        wireTabs(found.menu);
        wireMenuTabObserver(found.menu);
        var a = document.createElement('a');
        a.id = TAB_ID;
        a.className = 'item';
        a.href = '#';
        a.innerHTML = '<div>\u{1F3DB}\u{FE0F} Wall of Fame</div>';
        var insertAfter = document.getElementById('dc-fims-top-clickers-host') || found.advisoriesTab;
        insertAfter.insertAdjacentElement('afterend', a);
        wireWofTabCapture(a);
        return a;
    }

    function ensureUi() {
        ensureTab();
        ensurePanel();
    }

    function bootScan() {
        var t = document.getElementById(TABLE_ID);
        if (t) {
            ensureUi();
        }
    }

    rootMo = new MutationObserver(function() {
        bootScan();
    });
    rootMo.observe(document.documentElement, { childList: true, subtree: true });
    bootScan();

    function navKey() {
        return (window.location.pathname || '') + (window.location.search || '') + (window.location.hash || '');
    }
    function onNavMaybe() {
        if (navKey() !== lastNavKey) {
            lastNavKey = navKey();
            bootScan();
        }
    }
    lastNavKey = navKey();
    onPopState = onNavMaybe;
    onHashChange = onNavMaybe;
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    navInterval = window.setInterval(onNavMaybe, 2000);

    window.__myScriptCleanup = function() {
        if (navInterval) {
            clearInterval(navInterval);
            navInterval = null;
        }
        window.removeEventListener('popstate', onPopState);
        window.removeEventListener('hashchange', onHashChange);
        if (rootMo) {
            rootMo.disconnect();
            rootMo = null;
        }
        if (menuTabMo) {
            menuTabMo.disconnect();
            menuTabMo = null;
        }
        if (menuTabDebounce) {
            clearTimeout(menuTabDebounce);
            menuTabDebounce = null;
        }
        if (wofDocCaptureWired) {
            document.removeEventListener('click', onWofDocCapture, true);
            wofDocCaptureWired = false;
        }
        var tab = document.getElementById(TAB_ID);
        if (tab && tab.parentNode) {
            tab.parentNode.removeChild(tab);
        }
        var panel = document.getElementById(PANEL_ID);
        if (panel && panel.parentNode) {
            panel.parentNode.removeChild(panel);
        }
        var st = document.getElementById(STYLE_ID);
        if (st && st.parentNode) {
            st.parentNode.removeChild(st);
        }
        var menuInfo = findTabMenu();
        if (menuInfo && menuInfo.menu) {
            delete menuInfo.menu.dataset.dcWofTabWire;
            delete menuInfo.menu.dataset.dcWofMenuMo;
        }
        window.__myScriptCleanup = undefined;
    };
})();
